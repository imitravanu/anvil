import { describe, expect, it, vi, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  MAX_LIST_PAGES,
  McpClient,
  callTool,
  connectAllMcpServers,
  connectServer,
  type McpServerConnection,
} from "../client.js";
import { FakeMcpTransport } from "./fakeMcpTransport.js";
import type { ValidatedMcpServer } from "../../config/mcp.js";

/** A transport whose reply to any sent message is supplied per-call. */
class RawTransport extends FakeMcpTransport {
  constructor(private readonly reply: (parsed: { id?: number | string }) => string | null) {
    super(() => ({}));
  }
  override send(msg: string): void {
    const parsed = JSON.parse(msg) as { id?: number | string };
    const line = this.reply(parsed);
    if (line !== null) this.emit(line);
  }
}

function mkSrv(id: string): ValidatedMcpServer {
  return {
    id,
    transport: "stdio",
    command: "unused-in-these-tests",
    args: [],
    env: {},
    url: "",
    headers: {},
    timeoutMs: 500,
  };
}

describe("McpClient.request semantics", () => {
  it("resolves the JSON-RPC result and ignores junk/notifications", async () => {
    const t = new FakeMcpTransport((m) => ({ ok: m }));
    const client = new McpClient(t);
    t.emit("not json at all");
    t.emit(JSON.stringify({ jsonrpc: "2.0", method: "notifications/progress", params: {} }));
    expect(await client.request("ping")).toEqual({ ok: "ping" });
    t.close();
  });

  it("raises a JSON-RPC error as a rejection", async () => {
    const t = new RawTransport((p) => JSON.stringify({ jsonrpc: "2.0", id: p.id, error: { message: "boom" } }));
    await expect(new McpClient(t).request("x")).rejects.toThrow(/JSON-RPC error: boom/);
    t.close();
  });

  it("times out on a hung server", async () => {
    const t = new FakeMcpTransport(() => ({}));
    t.hangMethods.add("slow");
    await expect(new McpClient(t).request("slow", {}, { timeoutMs: 20 })).rejects.toThrow(/timed out after 20ms/);
    t.close();
  });

  it("honors an abort signal", async () => {
    const t = new RawTransport(() => null);
    const ctrl = new AbortController();
    const p = new McpClient(t).request("x", {}, { signal: ctrl.signal, timeoutMs: 5_000 });
    ctrl.abort();
    await expect(p).rejects.toThrow(/aborted/);
    t.close();
  });

  it("fails fast when the transport closes mid-request", async () => {
    const t = new RawTransport(() => null);
    const p = new McpClient(t).request("x", {}, { timeoutMs: 5_000 });
    t.close();
    await expect(p).rejects.toThrow(/transport closed/);
  });
});

describe("connectServer", () => {
  it("negotiates a version, lists tools, and drops malformed entries", async () => {
    const t = new FakeMcpTransport((m) => {
      if (m === "initialize") return { protocolVersion: "2024-11-05" };
      if (m === "tools/list") {
        return {
          tools: [
            { name: "read", description: "d", inputSchema: {}, annotations: { readOnlyHint: true } },
            { notARealTool: true },
          ],
        };
      }
      return {};
    });
    const conn = await connectServer("srv", mkSrv("srv"), t);
    expect(conn.status).toBe("ready");
    expect(conn.serverVersion).toBe("2024-11-05");
    expect(conn.tools.map((x) => x.name)).toEqual(["read"]);
    expect(conn.tools[0].readOnly).toBe(true);
    t.close();
  });

  it("caps tools/list pagination at MAX_LIST_PAGES", async () => {
    let page = 0;
    const t = new FakeMcpTransport((m) =>
      m === "initialize" ? {} : m === "tools/list" ? { tools: [], nextCursor: `c${++page}` } : {}
    );
    const conn = await connectServer("srv", mkSrv("srv"), t);
    expect(conn.status).toBe("ready");
    expect(t.methodsSeen().filter((m) => m === "tools/list")).toHaveLength(MAX_LIST_PAGES);
    t.close();
  });

  it("stops on a repeated cursor instead of looping", async () => {
    const t = new FakeMcpTransport((m) =>
      m === "initialize" ? {} : m === "tools/list" ? { tools: [], nextCursor: "same" } : {}
    );
    await connectServer("srv", mkSrv("srv"), t);
    expect(t.methodsSeen().filter((m) => m === "tools/list")).toHaveLength(2);
    t.close();
  });

  it("returns an error connection (never throws) when the handshake hangs", async () => {
    const t = new FakeMcpTransport(() => ({}));
    t.hangMethods.add("initialize");
    const conn = await connectServer("srv", mkSrv("srv"), t, { timeoutMs: 20 });
    expect(conn.status).toBe("error");
    expect(conn.tools).toEqual([]);
    expect(conn.error).toBeTruthy();
  });
});

describe("connectAllMcpServers", () => {
  const prevHome = process.env.ANVIL_HOME;
  afterEach(() => {
    if (prevHome === undefined) delete process.env.ANVIL_HOME;
    else process.env.ANVIL_HOME = prevHome;
  });

  it("closes and drops connections no longer in the config", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-mcp-"));
    process.env.ANVIL_HOME = tmp;
    try {
      const close = vi.fn();
      const conns = new Map<string, McpServerConnection>([
        ["ghost", { id: "ghost", status: "ready", tools: [], timeoutMs: 500, transport: { close } as never }],
      ]);
      const res = await connectAllMcpServers(conns);
      expect(conns.size).toBe(0);
      expect(close).toHaveBeenCalledTimes(1);
      expect(res).toEqual({ problems: [], connected: 0, tools: 0 });
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("callTool guards", () => {
  it("refuses an unknown tool on a ready connection", async () => {
    const conn: McpServerConnection = {
      id: "srv",
      status: "ready",
      tools: [{ serverId: "srv", name: "ping", description: "", inputSchema: {}, readOnly: true }],
      client: { request: async () => ({}) } as never,
      timeoutMs: 500,
    };
    const res = await callTool(conn, "nope", {});
    expect(res.isError).toBe(true);
    expect((res.output as { error: string }).error).toContain('Unknown MCP tool "nope"');
  });

  it("passes a successful result through and mirrors its isError flag", async () => {
    const conn: McpServerConnection = {
      id: "srv",
      status: "ready",
      tools: [{ serverId: "srv", name: "ping", description: "", inputSchema: {}, readOnly: true }],
      client: { request: async () => ({ content: [], isError: true }) } as never,
      timeoutMs: 500,
    };
    const res = await callTool(conn, "ping", { a: 1 });
    expect(res.isError).toBe(true);
    expect(res.output).toEqual({ content: [], isError: true });
  });

  it("refuses a not-ready connection that cannot be reconnected", async () => {
    const conn: McpServerConnection = { id: "srv", status: "error", tools: [], timeoutMs: 500 };
    const res = await callTool(conn, "t", {});
    expect(res.isError).toBe(true);
    expect((res.output as { error: string }).error).toContain('MCP server "srv" is not ready');
  });
});
