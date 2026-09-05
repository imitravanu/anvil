import type { McpTransport } from "./transport.js";
import { createStdioTransport } from "./transport.js";
import { loadMcpConfig } from "../config/mcp.js";
import type { ValidatedMcpServer } from "../config/mcp.js";
import { CORE_VERSION } from "../version.js";

// ---------------------------------------------------------------------------
// MCP client: minimal JSON-RPC 2.0 over an McpTransport (Phase 10).
// Handshake: initialize → notifications/initialized → tools/list (paginated).
// See docs/PHASE-10-SPEC.md §3.2.
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

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

/**
 * One client per connection: multiplexes concurrent requests by JSON-RPC id
 * over a single line pump. Late responses (after timeout/abort) have no
 * pending entry and are ignored — the transport stays usable (M7).
 */
export class McpClient {
  private seq = 0;
  private pending = new Map<number, (msg: Record<string, unknown>) => void>();
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
    // Server notifications have no id — v1 reads and ignores them (§3.2).
    if (msg.id === undefined || msg.id === null) return;
    const resolve = this.pending.get(msg.id as number);
    if (resolve) {
      this.pending.delete(msg.id as number);
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
    const reply = new Promise<Record<string, unknown>>((resolve) => {
      this.pending.set(id, resolve);
    });
    this.transport.send(JSON.stringify({ jsonrpc: "2.0", id, method, params: params ?? {} }));

    let timer: ReturnType<typeof setTimeout> | null = null;
    const settle = (marker: Record<string, unknown>) => {
      this.pending.delete(id);
      return marker;
    };
    const timeout = new Promise<Record<string, unknown>>((resolve) => {
      timer = setTimeout(() => resolve(settle({ __timeout: true })), timeoutMs);
    });
    const aborted = new Promise<Record<string, unknown>>((resolve) => {
      if (opts?.signal?.aborted) {
        resolve(settle({ __aborted: true }));
      } else {
        opts?.signal?.addEventListener("abort", () => resolve(settle({ __aborted: true })), {
          once: true,
        });
      }
    });
    try {
      const msg = await Promise.race([reply, timeout, aborted]);
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
      this.pending.delete(id);
    }
  }

  /** Fire-and-forget server notification (no id, no reply expected). */
  notify(method: string, params?: Record<string, unknown>): void {
    this.transport.send(JSON.stringify({ jsonrpc: "2.0", method, params: params ?? {} }));
  }
}

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
    return { id, status: "error", error, tools: [] };
  };
  try {
    const client = new McpClient(transport);
    const timeoutMs = opts?.timeoutMs;
    const init = await client.request(
      "initialize",
      {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "anvil", version: opts?.clientVersion ?? CORE_VERSION },
      },
      timeoutMs !== undefined ? { timeoutMs } : undefined
    );
    // Version negotiation (APPROVED DEVIATION from SPEC §3.2 echo-check, see
    // PHASE-10-PROGRESS: servers answer with their own version; strict echo
    // would brick interop on any drift while tools/list+tools/call are
    // stable across versions. The reported version is recorded, not enforced.
    const serverVersion =
      typeof init.protocolVersion === "string" ? init.protocolVersion : undefined;
    client.notify("notifications/initialized", {});
    const tools: McpToolDef[] = [];
    let cursor: string | undefined;
    do {
      const page = await client.request(
        "tools/list",
        cursor !== undefined ? { cursor } : {},
        timeoutMs !== undefined ? { timeoutMs } : undefined
      );
      const listed = Array.isArray(page.tools) ? page.tools : [];
      for (const t of listed) {
        const def = toToolDef(id, t);
        if (def) tools.push(def);
      }
      cursor = typeof page.nextCursor === "string" ? page.nextCursor : undefined;
    } while (cursor !== undefined);
    return { id, status: "ready", tools, serverVersion, transport, client };
  } catch (err: any) {
    return fail(err?.message ?? String(err));
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
      } catch (err: any) {
        conns.set(srv.id, { id: srv.id, status: "error", error: err?.message ?? String(err), tools: [] });
        return;
      }
      const old = conns.get(srv.id);
      try {
        old?.transport?.close();
      } catch {
        // ignore cleanup failures
      }
      conns.set(srv.id, await connectServer(srv.id, srv, transport, opts));
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
 * Call a server tool. Transport stays open on every outcome (timeouts and
 * errors resolve as results) — a failed call never poisons later calls (M7).
 */
export async function callTool(
  conn: McpServerConnection,
  toolName: string,
  args: unknown,
  opts?: { signal?: AbortSignal; timeoutMs?: number }
): Promise<McpCallResult> {
  if (conn.status !== "ready" || !conn.client) {
    return {
      output: { error: `MCP server "${conn.id}" is not ready${conn.error ? `: ${conn.error}` : ""}.` },
      isError: true,
    };
  }
  if (!conn.tools.some((t) => t.name === toolName)) {
    return { output: { error: `Unknown MCP tool "${toolName}" on server "${conn.id}".` }, isError: true };
  }
  try {
    const result = await conn.client.request(
      "tools/call",
      { name: toolName, arguments: isRecord(args) ? args : {} },
      { signal: opts?.signal, timeoutMs: opts?.timeoutMs }
    );
    return { output: result, isError: (result as { isError?: unknown }).isError === true };
  } catch (err: any) {
    return { output: { error: err?.message ?? String(err) }, isError: true };
  }
}
