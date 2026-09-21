import { spawn, type ChildProcess } from "node:child_process";
import { getErrorMessage } from "../errors.js";
import { LSP_REQUEST_TIMEOUT_MS } from "../config/constants.js";
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
  private rootUri: string;
  /** Set once the child exits or fails — a dead client must be recreated, not reused. */
  private dead = false;
  /** URIs opened via textDocument/didOpen (its version lives in `versions`). */
  private opened = new Set<string>();
  private versions = new Map<string, number>();

  private constructor(
    readonly server: LspServerCommand,
    projectRoot: string,
    child: ChildProcess
  ) {
    this.language = server.language;
    this.child = child;
    this.rootUri = `file://${projectRoot}`;
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
      child = spawn(server.command, server.args, { stdio: ["pipe", "pipe", "ignore"] });
    } catch {
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
      await client.close();
      return null;
    }
  }

  private frame(body: string): Buffer {
    const header = `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n`;
    return Buffer.concat([Buffer.from(header, "utf8"), Buffer.from(body, "utf8")]);
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      const header = this.buffer.subarray(0, headerEnd).toString("utf8");
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        this.buffer = this.buffer.subarray(headerEnd + 4);
        continue;
      }
      const length = Number(match[1]);
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
      const path = typeof params.uri === "string" ? params.uri.replace(/^file:\/\//, "") : "";
      for (const d of params.diagnostics ?? []) {
        this.collected.push({
          path,
          line: (d.range?.start?.line ?? 0) + 1,
          severity: d.severity === 1 ? "error" : d.severity === 2 ? "warning" : "info",
          message: d.message ?? "",
        });
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
    return path.startsWith("file://") ? path : `file://${path}`;
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
      this.opened.add(uri);
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
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
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
      return null;
    }
  }

  async diagnostics(): Promise<LspDiagnostic[]> {
    return [...this.collected];
  }

  async close(): Promise<void> {
    if (this.dead) return;
    this.dead = true;
    try {
      await this.request("shutdown", null, 3000);
    } catch {
      // shutdown is best-effort; the child is killed below regardless
    }
    this.notify("exit", null);
    try {
      this.child?.kill();
    } catch {
      // already gone — never let cleanup throw
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

const LSP_IDLE_CLOSE_MS = 60_000;
const clients = new Map<string, LspStdioClient>();
const idleTimers = new Map<string, NodeJS.Timeout>();
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
    for (const [, client] of clients) void client.close();
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
    void client.close();
    client = undefined;
  }
  if (!client) {
    client = await LspStdioClient.start(server, projectRoot);
    if (!client) return null;
    clients.set(key, client);
    registerExitCleanup();
  }
  scheduleIdleClose(key, client);
  return client;
}
