import { spawn, type ChildProcess } from "node:child_process";
import { pathToFileURL } from "node:url";
import { getErrorMessage } from "../errors.js";
import { LSP_REQUEST_TIMEOUT_MS, LSP_DIAGNOSTICS_POLL_MS, LSP_PATH_DIAGNOSTICS_POLL_MS, LSP_MAX_FRAME_BYTES, LSP_MAX_HEADER_BYTES, LSP_IDLE_CLOSE_MS, LSP_SHUTDOWN_TIMEOUT_MS, LSP_KILL_GRACE_MS } from "../config/constants.js";
import type { LspClient, LspDiagnostic, LspLocation, LspPosition, LspServerCommand } from "./types.js";

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

/**
 * Minimal JSON-RPC stdio LSP client. Speaks initialize/textDocument
 * requests over Content-Length framing; collects publishDiagnostics
 * notifications. Falls back gracefully — callers treat null as "no LSP".
 */
export class LspStdioClient implements LspClient {
  readonly language: LspClient["language"];
  private child: ChildProcess | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private buffer = Buffer.alloc(0);
  private collected: LspDiagnostic[] = [];

  private pathDiagnostics = new Map<string, { diagnostics: LspDiagnostic[]; timestamp: number }>();
  private rootUri: string;
  /** Set once the child exits or fails — a dead client must be recreated, not reused. */
  private dead = false;
  /** Set once close()/killSync() ran. Separate from `dead`: a client that died
   * on the frame cap is dead while its child still runs, and teardown must
   * still happen exactly once. */
  private closed = false;
  private versions = new Map<string, number>();

  private constructor(
    readonly server: LspServerCommand,
    projectRoot: string,
    child: ChildProcess
  ) {
    this.language = server.language;
    this.child = child;
    // pathToFileURL percent-encodes `#`, `%`, spaces, etc. A raw concatenation
    // turned a `#` into a URI fragment and broke the server's project root.
    this.rootUri = pathToFileURL(projectRoot).href;
    child.stdout?.on("data", (chunk: Buffer) => this.onData(chunk));
    child.on("exit", () => {
      this.dead = true;
      this.failAll(new Error("LSP server exited"));
    });
    child.on("error", (err: Error) => {
      this.dead = true;
      this.failAll(err);
    });
    // Async stdin failures (EPIPE after the server dies) never reach the
    // try/catch at the write site — an unlistened stream 'error' surfaces as an
    // uncaught exception. Fail the client instead (mcp/transport.ts does the
    // same for its child pipe).
    child.stdin?.on("error", () => {
      this.dead = true;
      this.failAll(new Error("LSP server stdin closed"));
    });
  }

  isDead(): boolean {
    return this.dead;
  }

  static async start(server: LspServerCommand, projectRoot: string): Promise<LspStdioClient | null> {
    let child: ChildProcess;
    try {
      // Own process group (mcp/transport.ts precedent): language servers spawn
      // helpers (indexers, watchers), so teardown must be able to sweep
      // descendants — killing only the direct child leaves those running
      // against the project. process.kill(-pid) throws on Windows, where
      // killTree falls back to the direct child.
      child = spawn(server.command, server.args, { stdio: ["pipe", "pipe", "ignore"], detached: true });
    } catch {
      // intentional: the server binary is missing/unspawnable; LSP is optional.
      return null;
    }
    if (!child.stdin || !child.stdout) return null;
    const client = new LspStdioClient(server, projectRoot, child);
    try {
      await client.request("initialize", {
        processId: process.pid,
        rootUri: client.rootUri,
        capabilities: {},
      });
      client.notify("initialized", {});
      return client;
    } catch {
      // intentional: a failed handshake means no usable LSP — close the child
      // and report the language server as unavailable.
      await client.close();
      return null;
    }
  }

  private frame(body: string): Buffer {
    const header = `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n`;
    return Buffer.concat([Buffer.from(header, "utf8"), Buffer.from(body, "utf8")]);
  }

  private onData(chunk: Buffer): void {
    let offset = 0;
    while (!this.dead && offset < chunk.length) {
      const room = LSP_MAX_FRAME_BYTES + LSP_MAX_HEADER_BYTES - this.buffer.length;
      if (room <= 0) { this.failFrame(); return; }
      const end = Math.min(chunk.length, offset + room);
      this.buffer = Buffer.concat([this.buffer, chunk.subarray(offset, end)]);
      offset = end;
      this.parseFrames();
    }
  }

  private failFrame(): void {
    this.buffer = Buffer.alloc(0);
    this.dead = true;
    this.failAll(new Error("LSP frame exceeds size cap"));
    this.killTree("SIGKILL");
  }

  private parseFrames(): void {
    for (;;) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) {
        if (this.buffer.length > LSP_MAX_HEADER_BYTES) this.failFrame();
        return;
      }
      if (headerEnd + 4 > LSP_MAX_HEADER_BYTES) { this.failFrame(); return; }
      const header = this.buffer.subarray(0, headerEnd).toString("utf8");
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        this.buffer = this.buffer.subarray(headerEnd + 4);
        continue;
      }
      const length = Number(match[1]);
      if (!Number.isFinite(length) || length < 0 || length > LSP_MAX_FRAME_BYTES) {
        // intentional: a hostile/buggy server claiming an unbounded frame
        // must not OOM the agent — drop the frame and fail the client.
        this.failFrame();
        return;
      }
      const bodyStart = headerEnd + 4;
      if (this.buffer.length < bodyStart + length) return;
      const body = this.buffer.subarray(bodyStart, bodyStart + length).toString("utf8");
      this.buffer = this.buffer.subarray(bodyStart + length);
      this.onMessage(body);
    }
  }

  private onMessage(body: string): void {
    let msg: { id?: number; method?: string; params?: unknown; result?: unknown; error?: { message?: string } };
    try {
      msg = JSON.parse(body) as typeof msg;
    } catch {
      // intentional: a malformed frame from an external server is dropped —
      // one bad message must not kill the reader.
      return;
    }
    if (typeof msg.id === "number" && this.pending.has(msg.id)) {
      const pending = this.pending.get(msg.id);
      if (!pending) return;
      this.pending.delete(msg.id);
      clearTimeout(pending.timer);
      if (msg.error) pending.reject(new Error(msg.error.message ?? "LSP error"));
      else pending.resolve(msg.result);
      return;
    }
    if (msg.method === "textDocument/publishDiagnostics") {
      const params = msg.params as { uri?: string; diagnostics?: { range?: { start?: { line?: number } }; severity?: number; message?: string }[] };
      const rawUri = typeof params.uri === "string" ? params.uri : "";
      const stripped = rawUri.replace(/^file:\/\//, "");
      let path: string;
      try {
        path = decodeURIComponent(stripped);
      } catch {
        // intentional: attacker-controlled URI with bad escapes must not
        // throw out of the stdout handler — fall back to the raw path.
        path = stripped;
      }
      const diags: LspDiagnostic[] = (params.diagnostics ?? []).map((d) => ({
        path,
        line: (d.range?.start?.line ?? 0) + 1,
        severity: d.severity === 1 ? "error" : d.severity === 2 ? "warning" : "info",
        message: d.message ?? "",
      }));
      this.pathDiagnostics.set(path, { diagnostics: diags, timestamp: Date.now() });
      for (const d of diags) {
        this.collected.push(d);
      }
    }
  }

  private failAll(err: Error): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(err);
    }
    this.pending.clear();
  }

  private notify(method: string, params: unknown): void {
    try {
      this.child?.stdin?.write(this.frame(JSON.stringify({ jsonrpc: "2.0", method, params })));
    } catch {
      // notifications are best-effort by LSP design
    }
  }

  private request(method: string, params: unknown, timeoutMs: number = LSP_REQUEST_TIMEOUT_MS): Promise<unknown> {
    const id = this.nextId++;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`LSP request timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.child?.stdin?.write(this.frame(JSON.stringify({ jsonrpc: "2.0", id, method, params })));
      } catch (err: unknown) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(new Error(getErrorMessage(err)));
      }
    });
  }

  private toUri(path: string): string {
    return path.startsWith("file://") ? path : pathToFileURL(path).href;
  }

  private toLocations(result: unknown): LspLocation[] {
    const items = Array.isArray(result) ? result : result ? [result] : [];
    const out: LspLocation[] = [];
    for (const item of items) {
      const loc = item as { uri?: string; range?: { start?: { line?: number; character?: number } }; targetUri?: string; targetRange?: { start?: { line?: number; character?: number } } };
      const uri = loc.uri ?? loc.targetUri ?? "";
      const start = loc.range?.start ?? loc.targetRange?.start;
      out.push({
        path: uri.replace(/^file:\/\//, ""),
        line: (start?.line ?? 0) + 1,
        character: start?.character ?? 0,
      });
    }
    return out;
  }

  /**
   * Open `path` (or sync its text if already open) per the LSP lifecycle.
   * Servers only resolve locations/hover/diagnostics for documents they know
   * about — a definition request on an unopened file legitimately returns
   * null (A1). First open sends textDocument/didOpen; later edits send
   * didChange with a bumped version so cached servers stay in sync.
   */
  ensureOpen(path: string, languageId: string, text: string): void {
    const uri = this.toUri(path);
    const prevVersion = this.versions.get(uri);
    if (prevVersion === undefined) {
      this.versions.set(uri, 1);
      this.notify("textDocument/didOpen", {
        textDocument: { uri, languageId, version: 1, text },
      });
    } else {
      const version = prevVersion + 1;
      this.versions.set(uri, version);
      this.notify("textDocument/didChange", {
        textDocument: { uri, version },
        contentChanges: [{ text }],
      });
    }
  }

  /**
   * Poll for publishDiagnostics after a didOpen. Servers push diagnostics on a
   * schedule that can lag the open; callers that need them wait a bounded
   * drain before reading.
   */
  async waitForDiagnostics(ms: number = 1000): Promise<LspDiagnostic[]> {
    const deadline = Date.now() + ms;
    while (this.collected.length === 0 && Date.now() < deadline) {
      if (this.dead) break;
      await new Promise<void>((resolve) => setTimeout(resolve, LSP_DIAGNOSTICS_POLL_MS));
    }
    return [...this.collected];
  }

  async gotoDefinition(path: string, position: LspPosition): Promise<LspLocation[]> {
    try {
      const result = await this.request("textDocument/definition", {
        textDocument: { uri: this.toUri(path) },
        position: { line: position.line - 1, character: position.character },
      });
      return this.toLocations(result);
    } catch {
      // intentional: an LSP query failure degrades to "no result" —
      // definition/reference lookups are best-effort, never hard errors.
      return [];
    }
  }

  async findReferences(path: string, position: LspPosition): Promise<LspLocation[]> {
    try {
      const result = await this.request("textDocument/references", {
        textDocument: { uri: this.toUri(path) },
        position: { line: position.line - 1, character: position.character },
        context: { includeDeclaration: true },
      });
      return this.toLocations(result);
    } catch {
      // intentional: an LSP query failure degrades to "no result" —
      // definition/reference lookups are best-effort, never hard errors.
      return [];
    }
  }

  async hover(path: string, position: LspPosition): Promise<string | null> {
    try {
      const result = (await this.request("textDocument/hover", {
        textDocument: { uri: this.toUri(path) },
        position: { line: position.line - 1, character: position.character },
      })) as { contents?: unknown } | null;
      if (!result || result.contents === undefined) return null;
      const contents = result.contents;
      if (typeof contents === "string") return contents;
      if (Array.isArray(contents)) {
        return contents
          .map((c) => (typeof c === "string" ? c : (c as { value?: string }).value ?? ""))
          .join("\n");
      }
      const marked = contents as { value?: string };
      return typeof marked.value === "string" ? marked.value : JSON.stringify(contents);
    } catch {
      // intentional: hover is a best-effort enrichment; failure means no hover.
      return null;
    }
  }

  /**
   * Poll for diagnostics on a specific path after a mutation.
   * Resolves immediately if diagnostics were already received at or after `sinceTimestamp`,
   * or polls until `timeoutMs` expires.
   */
  async diagnosticsForPath(targetPath: string, sinceTimestamp: number = 0, timeoutMs: number = 500): Promise<LspDiagnostic[]> {
    const deadline = Date.now() + timeoutMs;
    const matchesPath = (p: string): boolean => p === targetPath;
    const findForPath = (): LspDiagnostic[] | null => {
      for (const [p, val] of this.pathDiagnostics.entries()) {
        if (matchesPath(p)) {
          if (val.timestamp >= sinceTimestamp) {
            return val.diagnostics;
          }
        }
      }
      return null;
    };

    const initial = findForPath();
    if (initial !== null) return [...initial];

    while (Date.now() < deadline) {
      if (this.dead) break;
      await new Promise<void>((resolve) => setTimeout(resolve, LSP_PATH_DIAGNOSTICS_POLL_MS));
      const found = findForPath();
      if (found !== null) return [...found];
    }

    for (const [p, val] of this.pathDiagnostics.entries()) {
      if (matchesPath(p)) {
        // E3 (AUDIT-2026-09-30): the post-deadline fallback honors the SAME
        // freshness guard as the polling loop. Returning the cached entry
        // unconditionally let a mutation report diagnostics that predate it —
        // already-fixed errors looked live after a timeout.
        if (val.timestamp >= sinceTimestamp) return [...val.diagnostics];
      }
    }
    return [];
  }

  /**
   * Signal the server's process group, falling back to the direct child when
   * the group is unavailable (Windows, or a child that never became a leader).
   */
  private killTree(sig: NodeJS.Signals, child: ChildProcess | null = this.child): void {
    if (!child || child.pid == null || child.exitCode !== null) return;
    try {
      process.kill(-child.pid, sig);
    } catch {
      try {
        child.kill(sig);
      } catch {
        // intentional: already gone — cleanup never throws.
      }
    }
  }

  /**
   * SYNCHRONOUS hard stop for process-exit cleanup. An 'exit' handler cannot
   * await: the async close() below yields at its first await, so a kill placed
   * after it never runs and every phase exit would orphan the servers. This is
   * the lsp/client.ts counterpart of mcp/transport.ts killAllMcpServers().
   */
  killSync(): void {
    this.dead = true;
    this.closed = true;
    this.killTree("SIGKILL");
    this.child = null;
    this.failAll(new Error("LSP client disposed"));
  }

  async close(): Promise<void> {
    // Idempotent per TEARDOWN, not per `dead`: a client killed by the frame
    // cap (onData) is dead while its child keeps running, and the cache's
    // corpse-drop calls close() precisely to clean that up. Early-returning on
    // `dead` leaked that server for the life of the process.
    if (this.closed) return;
    this.closed = true;
    const wasDead = this.dead;
    this.dead = true;
    if (!wasDead) {
      try {
        await this.request("shutdown", null, LSP_SHUTDOWN_TIMEOUT_MS);
      } catch {
        // shutdown is best-effort; the child is killed below regardless
      }
      this.notify("exit", null);
    }
    // Graceful first — SIGTERM lets the server flush — then SIGKILL the group
    // if it outlives the grace. The timer is unref'd (never holds the process
    // open) and cleared when the child exits.
    const dying = this.child;
    this.killTree("SIGTERM", dying);
    if (dying) {
      const grace = setTimeout(() => this.killTree("SIGKILL", dying), LSP_KILL_GRACE_MS);
      (grace as unknown as { unref?: () => void }).unref?.();
      dying.once("exit", () => clearTimeout(grace));
    }
    this.child = null;
    this.failAll(new Error("LSP client closed"));
  }
}

// ---------------------------------------------------------------------------
// Per-language client cache. LSP servers are expensive to start (project
// indexing, process spawn); a fresh server per tool call would make the code
// tools unusably slow and would reset every file to "unopened" each call (A2).
// Clients live until an idle timeout closes them or the process exits.
// ---------------------------------------------------------------------------

const clients = new Map<string, LspStdioClient>();
const idleTimers = new Map<string, NodeJS.Timeout>();
const inflight = new Map<string, Promise<LspStdioClient | null>>();
let exitCleanupRegistered = false;

function cacheKey(language: string, projectRoot: string): string {
  return `${language}:${projectRoot}`;
}

function scheduleIdleClose(key: string, client: LspStdioClient): void {
  const existing = idleTimers.get(key);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    if (clients.get(key) === client) {
      clients.delete(key);
      idleTimers.delete(key);
      void client.close();
    }
  }, LSP_IDLE_CLOSE_MS);
  (timer as unknown as { unref?: () => void }).unref?.(); // never hold the process open
  idleTimers.set(key, timer);
}

function registerExitCleanup(): void {
  if (exitCleanupRegistered) return;
  exitCleanupRegistered = true;
  process.once("exit", () => {
    // Synchronous kills only: an 'exit' handler cannot await, so an async
    // close() here would set `dead` and then die before killing anything.
    for (const [, client] of clients) client.killSync();
    clients.clear();
    idleTimers.clear();
  });
}

/**
 * Resolve a shared LspStdioClient for a server/project, creating and
 * initializing one on first use and discarding it once it dies. The caller
 * does NOT own the lifecycle — the cache closes it on idle or process exit.
 */
export async function getLspClient(
  server: LspServerCommand,
  projectRoot: string
): Promise<LspStdioClient | null> {
  const key = cacheKey(server.language, projectRoot);
  let client: LspStdioClient | null | undefined = clients.get(key);
  if (client && client.isDead()) {
    clients.delete(key);
    // close() still kills the underlying child: a client that died on the
    // frame cap is dead while its server keeps running.
    void client.close();
    client = undefined;
  }
  if (client) {
    scheduleIdleClose(key, client);
    return client;
  }
  const pending = inflight.get(key);
  if (pending) return pending;
  const start = (async (): Promise<LspStdioClient | null> => {
    const started = await LspStdioClient.start(server, projectRoot);
    if (!started) return null;
    // Single-flight guard: a concurrent caller may have populated the cache
    // while we were starting — keep the winner, close the loser.
    const raced = clients.get(key);
    if (raced && !raced.isDead()) {
      void started.close();
      scheduleIdleClose(key, raced);
      return raced;
    }
    clients.set(key, started);
    registerExitCleanup();
    scheduleIdleClose(key, started);
    return started;
  })();
  inflight.set(key, start);
  try {
    return await start;
  } finally {
    inflight.delete(key);
  }
}
