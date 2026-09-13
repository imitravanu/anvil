import { getErrorMessage } from "../errors.js";
import type { McpTransport } from "./transport.js";
import { createStdioTransport } from "./transport.js";
import { loadMcpConfig } from "../config/mcp.js";
import type { ValidatedMcpServer } from "../config/mcp.js";
import { CORE_VERSION } from "../version.js";
import { DEFAULT_MCP_REQUEST_TIMEOUT_MS } from "../config/constants.js";

// ---------------------------------------------------------------------------
// MCP client: minimal JSON-RPC 2.0 over an McpTransport.
// Handshake: initialize → notifications/initialized → tools/list (paginated).
// ---------------------------------------------------------------------------

/** Protocol version we declare. Recorded; see version-negotiation note below. */
export const MCP_PROTOCOL_VERSION = "2025-11-25";

export interface McpToolDef {
  serverId: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  readOnly: boolean;
}

export type McpServerStatus = "ready" | "error" | "misconfigured";

export interface McpServerConnection {
  id: string;
  status: McpServerStatus;
  error?: string;
  tools: McpToolDef[];
  /** Version the server reported (informational; see negotiation note). */
  serverVersion?: string;
  transport?: McpTransport;
  /** Live client for ready connections (absent otherwise). */
  client?: McpClient;
  /** Per-call timeout default, from the server's config. */
  timeoutMs: number;
  /** Retained server config for health checks and auto-reconnection. */
  serverConfig?: ValidatedMcpServer;
}

export interface McpCallResult {
  output: unknown;
  isError: boolean;
}

class McpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpError";
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const DEFAULT_REQUEST_TIMEOUT_MS = DEFAULT_MCP_REQUEST_TIMEOUT_MS;

/**
 * One client per connection: multiplexes concurrent requests by JSON-RPC id
 * over a single line pump. Late responses (after timeout/abort) have no
 * pending entry and are ignored — the transport stays usable .
 */
export class McpClient {
  private seq = 0;
  private pending = new Map<number | string, (msg: Record<string, unknown>) => void>();
  private pumping = false;

  constructor(private readonly transport: McpTransport) {}

  private pump(): void {
    if (this.pumping) return;
    this.pumping = true;
    void (async () => {
      try {
        for await (const line of this.transport.lines()) {
          this.route(line);
        }
      } catch {
        // stream ended unexpectedly — pending calls fail via their own paths
      } finally {
        // Restartable: after transport death the next request() spins a fresh
        // pump, which drains to {closed:true} immediately → fast McpError
        // instead of hanging to timeout.
        this.pumping = false;
      }
      for (const resolve of this.pending.values()) resolve({ closed: true });
      this.pending.clear();
    })();
  }

  private route(line: string): void {
    let msg: unknown;
    try {
      msg = JSON.parse(line);
    } catch {
      return; // malformed line — ignore (framing is newline-delimited JSON)
    }
    if (!isRecord(msg)) return;
    // Server notifications have no id — read and ignore them.
    // JSON-RPC ids may be numbers OR strings — both must route.
    if (typeof msg.id !== "number" && typeof msg.id !== "string") return;
    const resolve = this.pending.get(msg.id);
    if (resolve) {
      this.pending.delete(msg.id);
      resolve(msg);
    }
  }

  /** Raw request. Throws McpError on timeout, abort, close, or JSON-RPC error. */
  async request(
    method: string,
    params?: Record<string, unknown>,
    opts?: { timeoutMs?: number; signal?: AbortSignal }
  ): Promise<Record<string, unknown>> {
    this.pump();
    if (opts?.signal?.aborted) throw new McpError("aborted");
    const id = ++this.seq;
    const timeoutMs = opts?.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    const signal = opts?.signal;
    const reply = new Promise<Record<string, unknown>>((resolve) => {
      this.pending.set(id, resolve);
    });
    this.transport.send(JSON.stringify({ jsonrpc: "2.0", id, method, params: params ?? {} }));

    let timer: ReturnType<typeof setTimeout> | null = null;
    let onAbort: (() => void) | null = null;
    const settle = (marker: Record<string, unknown>) => {
      this.pending.delete(id);
      return marker;
    };
    const timeout = new Promise<Record<string, unknown>>((resolve) => {
      timer = setTimeout(() => resolve(settle({ __timeout: true })), timeoutMs);
    });
    const racers: Promise<Record<string, unknown>>[] = [reply, timeout];
    if (signal) {
      racers.push(
        new Promise<Record<string, unknown>>((resolve) => {
          if (signal.aborted) {
            resolve(settle({ __aborted: true }));
          } else {
            // Named handler so finally can remove it: every request on a
            // shared long-lived signal leaked one listener before this fix.
            onAbort = () => resolve(settle({ __aborted: true }));
            signal.addEventListener("abort", onAbort, { once: true });
          }
        })
      );
    }
    try {
      const msg = await Promise.race(racers);
      if ((msg as { __aborted?: boolean }).__aborted) throw new McpError("aborted");
      if ((msg as { __timeout?: boolean }).__timeout) throw new McpError(`request timed out after ${timeoutMs}ms: ${method}`);
      if ((msg as { closed?: boolean }).closed) throw new McpError("transport closed");
      if (msg.error !== undefined) {
        const e = isRecord(msg.error) ? (msg.error.message as string) ?? "unknown error" : String(msg.error);
        throw new McpError(`JSON-RPC error: ${e}`);
      }
      return (msg.result !== undefined ? msg.result : {}) as Record<string, unknown>;
    } finally {
      if (timer) clearTimeout(timer);
      if (onAbort && signal) signal.removeEventListener("abort", onAbort);
      this.pending.delete(id);
    }
  }

  /** Fire-and-forget server notification (no id, no reply expected). */
  notify(method: string, params?: Record<string, unknown>): void {
    this.transport.send(JSON.stringify({ jsonrpc: "2.0", method, params: params ?? {} }));
  }
}

/** Cap on tools/list pages per connection (a cursor loop must not hang boot). */
export const MAX_LIST_PAGES = 20;

function toToolDef(serverId: string, t: unknown): McpToolDef | null {
  if (!isRecord(t) || typeof t.name !== "string" || t.name.length === 0) return null;
  const annotations = isRecord(t.annotations) ? t.annotations : {};
  return {
    serverId,
    name: t.name,
    description: typeof t.description === "string" ? t.description : "",
    inputSchema: isRecord(t.inputSchema) ? (t.inputSchema as Record<string, unknown>) : { type: "object", properties: {} },
    readOnly: annotations.readOnlyHint === true,
  };
}

/**
 * Connect + handshake + list tools. NEVER throws: every failure mode returns
 * `{ status: "error", error, tools: [] }` — boot must survive a dead server.
 */
export async function connectServer(
  id: string,
  cfg: ValidatedMcpServer,
  transport: McpTransport,
  opts?: { timeoutMs?: number; clientVersion?: string }
): Promise<McpServerConnection> {
  const fail = (error: string): McpServerConnection => {
    try {
      transport.close();
    } catch {
      // ignore cleanup failures
    }
    return { id, status: "error", error, tools: [], timeoutMs: cfg.timeoutMs, serverConfig: cfg };
  };
  try {
    const client = new McpClient(transport);
    // Boot passes an explicit connect cap; otherwise the server's own
    // configured timeout applies (P0: cfg.timeoutMs was validated but never
    // read — the field is now the default everywhere below).
    const timeoutMs = opts?.timeoutMs ?? cfg.timeoutMs;
    const init = await client.request(
      "initialize",
      {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "anvil", version: opts?.clientVersion ?? CORE_VERSION },
      },
      timeoutMs !== undefined ? { timeoutMs } : undefined
    );
    // Version negotiation: servers answer with their own version. A strict
    // echo-check would brick interop on any drift, and tools/list +
    // tools/call are stable across versions — so we record it, not enforce it.
    const serverVersion =
      typeof init.protocolVersion === "string" ? init.protocolVersion : undefined;
    client.notify("notifications/initialized", {});
    const tools: McpToolDef[] = [];
    // A buggy or hostile server that repeats nextCursor forever must not hang
    // boot: cap pages and stop on a repeated cursor.
    const seenCursors = new Set<string>();
    let cursor: string | undefined;
    let pages = 0;
    do {
      if (pages >= MAX_LIST_PAGES) break;
      pages += 1;
      const page = await client.request(
        "tools/list",
        cursor !== undefined ? { cursor } : {},
        { timeoutMs }
      );
      const listed = Array.isArray(page.tools) ? page.tools : [];
      for (const t of listed) {
        const def = toToolDef(id, t);
        if (def) tools.push(def);
      }
      const next = typeof page.nextCursor === "string" ? page.nextCursor : undefined;
      if (next !== undefined && seenCursors.has(next)) break;
      if (next !== undefined) seenCursors.add(next);
      cursor = next;
    } while (cursor !== undefined);
    return { id, status: "ready", tools, serverVersion, transport, client, timeoutMs, serverConfig: cfg };
  } catch (err: unknown) {
    return fail(getErrorMessage(err));
  }
}

/**
 * Connect every configured server into `conns` (mutated in place so live
 * executors see the refresh with no stale map). Single owner for CLI boot
 * and `/mcp reconnect`. Servers removed from the config are closed and
 * dropped. NEVER throws — per-server failures land in `problems` and as
 * error-status connections.
 */
export async function connectAllMcpServers(
  conns: Map<string, McpServerConnection>,
  opts?: { timeoutMs?: number }
): Promise<{ problems: string[]; connected: number; tools: number }> {
  const cfg = loadMcpConfig();
  const problems = cfg.problems.map((p) => `${p.id}: ${p.error}`);
  const wanted = new Set(cfg.servers.map((s) => s.id));
  await Promise.all(
    cfg.servers.map(async (srv) => {
      let transport: McpTransport;
      try {
        transport = createStdioTransport(srv.command, srv.args, srv.env);
      } catch (err: unknown) {
        conns.set(srv.id, { id: srv.id, status: "error", error: getErrorMessage(err), tools: [], timeoutMs: srv.timeoutMs, serverConfig: srv });
        return;
      }
      const old = conns.get(srv.id);
      // Connect the replacement BEFORE touching the live connection: a
      // transient failure must not convert a previously `ready` server into
      // a dead one (the old code closed first, then stored the error).
      const next = await connectServer(srv.id, srv, transport, opts);
      if (next.status === "ready") {
        try {
          old?.transport?.close();
        } catch {
          // ignore cleanup failures
        }
        conns.set(srv.id, next);
      } else {
        try {
          transport.close();
        } catch {
          // ignore cleanup failures
        }
        if (!old || old.status !== "ready") conns.set(srv.id, next);
      }
    })
  );
  for (const [id, conn] of [...conns]) {
    if (!wanted.has(id)) {
      try {
        conn.transport?.close();
      } catch {
        // ignore
      }
      conns.delete(id);
    }
  }
  let tools = 0;
  let connected = 0;
  for (const conn of conns.values()) {
    if (conn.status === "ready") {
      connected += 1;
      tools += conn.tools.length;
    }
  }
  return { problems, connected, tools };
}

/**
 * Attempt to reconnect a dead or errored server connection in place.
 * Returns true if the connection was successfully re-established.
 */
export async function reconnectServerConnection(
  conn: McpServerConnection,
  opts?: { timeoutMs?: number }
): Promise<boolean> {
  if (!conn.serverConfig) return false;
  try {
    conn.transport?.close();
  } catch {
    // ignore cleanup failures
  }
  try {
    const transport = createStdioTransport(
      conn.serverConfig.command,
      conn.serverConfig.args,
      conn.serverConfig.env
    );
    const fresh = await connectServer(conn.id, conn.serverConfig, transport, opts);
    if (fresh.status === "ready" && fresh.client) {
      conn.status = "ready";
      conn.error = undefined;
      conn.tools = fresh.tools;
      conn.serverVersion = fresh.serverVersion;
      conn.transport = fresh.transport;
      conn.client = fresh.client;
      conn.timeoutMs = fresh.timeoutMs;
      return true;
    } else {
      conn.status = fresh.status;
      conn.error = fresh.error;
      return false;
    }
  } catch (err: unknown) {
    conn.status = "error";
    conn.error = getErrorMessage(err);
    return false;
  }
}

/**
 * Call a server tool. Transport stays open on every outcome (timeouts and
 * errors resolve as results) — a failed call never poisons later calls.
 * If transport is closed or dead, automatically attempts reconnection once.
 */
export async function callTool(
  conn: McpServerConnection,
  toolName: string,
  args: unknown,
  opts?: { signal?: AbortSignal; timeoutMs?: number }
): Promise<McpCallResult> {
  if (conn.status !== "ready" || !conn.client) {
    if (conn.serverConfig) {
      const reconnected = await reconnectServerConnection(conn, { timeoutMs: opts?.timeoutMs ?? conn.timeoutMs });
      if (!reconnected || !conn.client) {
        return {
          output: { error: `MCP server "${conn.id}" is not ready${conn.error ? `: ${conn.error}` : ""}.` },
          isError: true,
        };
      }
    } else {
      return {
        output: { error: `MCP server "${conn.id}" is not ready${conn.error ? `: ${conn.error}` : ""}.` },
        isError: true,
      };
    }
  }
  if (!conn.tools.some((t) => t.name === toolName)) {
    return { output: { error: `Unknown MCP tool "${toolName}" on server "${conn.id}".` }, isError: true };
  }
  try {
    const result = await conn.client.request(
      "tools/call",
      { name: toolName, arguments: isRecord(args) ? args : {} },
      // The connection's configured timeout is the default; explicit overrides win.
      { signal: opts?.signal, timeoutMs: opts?.timeoutMs ?? conn.timeoutMs }
    );
    return { output: result, isError: (result as { isError?: unknown }).isError === true };
  } catch (err: unknown) {
    const msg = getErrorMessage(err).toLowerCase();
    const isTransportDead = msg.includes("transport closed") || msg.includes("econnreset") || msg.includes("epipe");
    if (isTransportDead && conn.serverConfig) {
      const reconnected = await reconnectServerConnection(conn, { timeoutMs: opts?.timeoutMs ?? conn.timeoutMs });
      if (reconnected && conn.client) {
        try {
          const retryResult = await conn.client.request(
            "tools/call",
            { name: toolName, arguments: isRecord(args) ? args : {} },
            { signal: opts?.signal, timeoutMs: opts?.timeoutMs ?? conn.timeoutMs }
          );
          return { output: retryResult, isError: (retryResult as { isError?: unknown }).isError === true };
        } catch (retryErr: unknown) {
          return { output: { error: getErrorMessage(retryErr) }, isError: true };
        }
      }
    }
    return { output: { error: getErrorMessage(err) }, isError: true };
  }
}
