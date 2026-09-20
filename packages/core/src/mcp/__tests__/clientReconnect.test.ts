import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ValidatedMcpServer } from "../../config/mcp.js";
import { FakeMcpTransport } from "./fakeMcpTransport.js";

/**
 * The reconnect path builds a real stdio/SSE transport, so the two factories
 * are stubbed: these tests are about the reconnect *state machine*, not the
 * process/HTTP layer (transport.test.ts and sse.test.ts own that).
 */
const harness = vi.hoisted(() => ({
  nextTransport: null as unknown,
  createCalls: 0,
  throwOnCreate: false,
}));

vi.mock("../transport.js", () => ({
  createStdioTransport: () => {
    harness.createCalls += 1;
    if (harness.throwOnCreate) throw new Error("spawn failed: ENOENT");
    if (!harness.nextTransport) throw new Error("no transport staged for this test");
    return harness.nextTransport;
  },
  createSseTransport: async () => {
    harness.createCalls += 1;
    if (harness.throwOnCreate) throw new Error("spawn failed: ENOENT");
    if (!harness.nextTransport) throw new Error("no transport staged for this test");
    return harness.nextTransport;
  },
}));

import { callTool, reconnectServerConnection, type McpServerConnection } from "../client.js";

function mkSrv(): ValidatedMcpServer {
  return {
    id: "srv",
    transport: "stdio",
    command: "unused",
    args: [],
    env: {},
    url: "",
    headers: {},
    timeoutMs: 500,
  };
}

/** A staged transport that completes the handshake and answers tools/call. */
function readyTransport(): FakeMcpTransport {
  return new FakeMcpTransport((m) => {
    if (m === "initialize") return { protocolVersion: "2025-11-25" };
    if (m === "tools/list") {
      return { tools: [{ name: "ping", description: "", inputSchema: {}, annotations: {} }] };
    }
    if (m === "tools/call") return { content: [{ type: "text", text: "ok" }] };
    return {};
  });
}

beforeEach(() => {
  harness.nextTransport = null;
  harness.createCalls = 0;
  harness.throwOnCreate = false;
});

describe("reconnectServerConnection", () => {
  it("returns false when there is no retained server config", async () => {
    const ok = await reconnectServerConnection({ id: "srv", status: "error", tools: [], timeoutMs: 500 });
    expect(ok).toBe(false);
    expect(harness.createCalls).toBe(0);
  });

  it("re-establishes a dead connection in place", async () => {
    harness.nextTransport = readyTransport();
    const conn: McpServerConnection = { id: "srv", status: "error", error: "old failure", tools: [], timeoutMs: 500, serverConfig: mkSrv() };
    const ok = await reconnectServerConnection(conn);
    expect(ok).toBe(true);
    expect(conn.status).toBe("ready");
    expect(conn.error).toBeUndefined();
    expect(conn.tools.map((t) => t.name)).toEqual(["ping"]);
    expect(conn.client).toBeTruthy();
  });

  it("keeps the connection dead when the handshake fails", async () => {
    const dead = new FakeMcpTransport(() => ({}));
    dead.hangMethods.add("initialize");
    harness.nextTransport = dead;
    const conn: McpServerConnection = { id: "srv", status: "error", tools: [], timeoutMs: 500, serverConfig: mkSrv() };
    const ok = await reconnectServerConnection(conn, { timeoutMs: 20 });
    expect(ok).toBe(false);
    expect(conn.status).toBe("error");
    expect(conn.error).toBeTruthy();
  });

  it("reports a transport-construction failure as an error status", async () => {
    harness.throwOnCreate = true;
    const conn: McpServerConnection = { id: "srv", status: "ready", tools: [], timeoutMs: 500, serverConfig: mkSrv() };
    const ok = await reconnectServerConnection(conn);
    expect(ok).toBe(false);
    expect(conn.status).toBe("error");
    expect(conn.error).toContain("ENOENT");
  });
});

describe("callTool auto-recovery", () => {
  it("reconnects once on a dead transport and replays the call", async () => {
    harness.nextTransport = readyTransport();
    let attempts = 0;
    const conn = {
      id: "srv",
      status: "ready" as const,
      tools: [{ serverId: "srv", name: "ping", description: "", inputSchema: {}, readOnly: true }],
      timeoutMs: 500,
      serverConfig: mkSrv(),
      client: {
        request: async () => {
          attempts += 1;
          throw new Error("transport closed");
        },
      },
    } as unknown as Parameters<typeof callTool>[0];
    const res = await callTool(conn, "ping", {});
    expect(attempts).toBe(1);
    expect(harness.createCalls).toBe(1);
    expect(res.isError).toBe(false);
    expect(res.output).toEqual({ content: [{ type: "text", text: "ok" }] });
  });

  it("surfaces the original failure when the reconnect cannot be built", async () => {
    harness.throwOnCreate = true;
    const conn = {
      id: "srv",
      status: "ready" as const,
      tools: [{ serverId: "srv", name: "ping", description: "", inputSchema: {}, readOnly: true }],
      timeoutMs: 500,
      serverConfig: mkSrv(),
      client: {
        request: async () => {
          throw new Error("transport closed");
        },
      },
    } as unknown as Parameters<typeof callTool>[0];
    const res = await callTool(conn, "ping", {});
    expect(res.isError).toBe(true);
    expect((res.output as { error: string }).error).toContain("transport closed");
    expect(conn.status).toBe("error");
  });
});
