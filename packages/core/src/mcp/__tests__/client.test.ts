import { describe, expect, it } from "vitest";
import { getEventListeners } from "node:events";
import { FakeMcpTransport } from "./fakeMcpTransport.js";
import { McpClient, callTool, connectServer } from "../client.js";
import type { ValidatedMcpServer } from "../../config/mcp.js";

const CFG: ValidatedMcpServer = { id: "srv", command: "x", args: [], env: {}, timeoutMs: 1000 };

function toolList() {
  return {
    tools: [
      {
        name: "read",
        description: "Read a thing",
        inputSchema: { type: "object", properties: { id: { type: "string" } } },
        annotations: { readOnlyHint: true },
      },
      { name: "write stuff!", description: "Write", inputSchema: { type: "object" } },
    ],
  };
}

function handshakeFake() {
  return new FakeMcpTransport((method) => {
    if (method === "initialize") return { protocolVersion: "9-9", serverInfo: { name: "fake" } };
    if (method === "tools/list") return toolList();
    if (method === "tools/call") return { content: [{ type: "text", text: "ok" }] };
    throw new Error(`unexpected ${method}`);
  });
}

describe("mcp client", () => {
  it("M1: handshake order + tool mapping (readOnly honored, schema kept)", async () => {
    const transport = handshakeFake();
    const conn = await connectServer("srv", CFG, transport);
    expect(conn.status).toBe("ready");
    expect(transport.methodsSeen()).toEqual(["initialize", "notifications/initialized", "tools/list"]);
    expect(transport.sent[1]).not.toHaveProperty("id"); // initialized notification
    expect(conn.tools).toHaveLength(2);
    expect(conn.tools[0]).toMatchObject({
      serverId: "srv",
      name: "read",
      description: "Read a thing",
      readOnly: true,
    });
    expect(conn.tools[0].inputSchema).toEqual({ type: "object", properties: { id: { type: "string" } } });
    expect(conn.tools[1]).toMatchObject({ name: "write stuff!", readOnly: false });
    // Lenient version negotiation (recorded deviation): proceeds, records.
    expect(conn.serverVersion).toBe("9-9");
  });

  it("M4: tools/call round-trips content; unknown tool is an error", async () => {
    const transport = handshakeFake();
    const conn = await connectServer("srv", CFG, transport);
    const good = await callTool(conn, "read", { id: "1" });
    expect(good.isError).toBe(false);
    expect(good.output).toEqual({ content: [{ type: "text", text: "ok" }] });
    const bad = await callTool(conn, "nope", {});
    expect(bad.isError).toBe(true);
  });

  it("M4: server JSON-RPC error on call surfaces as isError", async () => {
    const transport = new FakeMcpTransport((method) => {
      if (method === "initialize") return { protocolVersion: "x" };
      if (method === "tools/list") return { tools: [{ name: "t", inputSchema: {} }] };
      throw new Error("handler must not be reached for raw error test");
    });
    // Raw JSON-RPC error object (not a transport throw):
    const origSend = transport.send.bind(transport);
    transport.send = (msg: string) => {
      const parsed = JSON.parse(msg) as { id?: number; method: string };
      if (parsed.method === "tools/call" && parsed.id !== undefined) {
        transport.emit(JSON.stringify({ jsonrpc: "2.0", id: parsed.id, error: { code: -32602, message: "bad args" } }));
        transport.sent.push({ jsonrpc: "2.0", id: parsed.id, method: parsed.method, params: {} });
        return;
      }
      origSend(msg);
    };
    const conn = await connectServer("srv", CFG, transport);
    const result = await callTool(conn, "t", {});
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.output)).toContain("bad args");
  });

  it("M6: failed handshake returns error status, never throws", async () => {
    const transport = new FakeMcpTransport(() => {
      throw new Error("boom");
    });
    const conn = await connectServer("srv", CFG, transport);
    expect(conn.status).toBe("error");
    expect(conn.tools).toEqual([]);
    expect(conn.error).toContain("boom");
    const call = await callTool(conn, "t", {});
    expect(call.isError).toBe(true);
    expect(JSON.stringify(call.output)).toContain("not ready");
  });

  it("M7: timeout errors the call but the transport stays usable", async () => {
    const transport = handshakeFake();
    transport.hangMethods.add("tools/call");
    const conn = await connectServer("srv", CFG, transport);
    expect(conn.status).toBe("ready");
    const timed = await callTool(conn, "read", {}, { timeoutMs: 30 });
    expect(timed.isError).toBe(true);
    expect(JSON.stringify(timed.output)).toContain("timed out");
    transport.hangMethods.delete("tools/call");
    const after = await callTool(conn, "read", {});
    expect(after.isError).toBe(false);
  });

  it("malformed tools entries are skipped, pagination followed", async () => {
    const transport = new FakeMcpTransport((method, params) => {
      if (method === "initialize") return { protocolVersion: "x" };
      if (method === "tools/list") {
        if ((params as { cursor?: string }).cursor === "p2") {
          return { tools: [{ name: "second" }] };
        }
        return { tools: [{ name: "first" }, { nope: 1 }, { name: "" }], nextCursor: "p2" };
      }
      return {};
    });
    const conn = await connectServer("srv", CFG, transport);
    expect(conn.tools.map((t) => t.name)).toEqual(["first", "second"]);
  });

  it("aborted calls error without hanging", async () => {
    const transport = handshakeFake();
    transport.hangMethods.add("tools/call");
    const conn = await connectServer("srv", CFG, transport);
    const controller = new AbortController();
    const pending = callTool(conn, "read", {}, { signal: controller.signal, timeoutMs: 5000 });
    controller.abort();
    const result = await pending;
    expect(result.isError).toBe(true);
  });

  it("stray string-id lines neither resolve calls nor corrupt routing", async () => {
    const transport = handshakeFake();
    const origSend = transport.send.bind(transport);
    transport.send = (msg: string) => {
      origSend(msg);
      // A server-initiated request (string id) mid-handshake: v1 ignores it.
      transport.emit(JSON.stringify({ jsonrpc: "2.0", id: "srv-1", method: "ping" }));
    };
    const conn = await connectServer("srv", CFG, transport);
    expect(conn.status).toBe("ready");
    expect(conn.tools).toHaveLength(2);
    const call = await callTool(conn, "read", {});
    expect(call.isError).toBe(false);
  });

  it("connection timeoutMs is the call default when no override is given", async () => {
    const transport = handshakeFake();
    transport.hangMethods.add("tools/call");
    const base = await connectServer("srv", CFG, transport);
    const conn = { ...base, timeoutMs: 30 };
    const timed = await callTool(conn, "read", {});
    expect(timed.isError).toBe(true);
    expect(JSON.stringify(timed.output)).toContain("timed out after 30ms");
  });

  it("abort listeners are removed after success (no leak on shared signals)", async () => {
    const transport = handshakeFake();
    const conn = await connectServer("srv", CFG, transport);
    const controller = new AbortController();
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
    await callTool(conn, "read", {}, { signal: controller.signal });
    await callTool(conn, "read", {}, { signal: controller.signal });
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  });

  it("a repeating tools/list cursor terminates instead of looping forever", async () => {
    let lists = 0;
    const transport = new FakeMcpTransport((method) => {
      if (method === "initialize") return { protocolVersion: "x" };
      if (method === "tools/list") {
        lists += 1;
        return { tools: [{ name: `t${lists}` }], nextCursor: "same" };
      }
      return {};
    });
    const conn = await connectServer("srv", CFG, transport);
    expect(conn.status).toBe("ready");
    expect(conn.tools.map((t) => t.name)).toEqual(["t1", "t2"]);
  });

  it("stdio smoke: real child process handshake + list + call + close", async () => {
    const { createStdioTransport } = await import("../transport.js");
    const serverScript = `
      let buf = "";
      process.stdin.on("data", (c) => {
        buf += c.toString();
        let nl;
        while ((nl = buf.indexOf("\\n")) >= 0) {
          const msg = JSON.parse(buf.slice(0, nl));
          buf = buf.slice(nl + 1);
          const reply = (result) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }) + "\\n");
          if (msg.method === "initialize") reply({ protocolVersion: "x-smoke", serverInfo: { name: "smoke" } });
          else if (msg.method === "tools/list") reply({ tools: [{ name: "ping", description: "pong", inputSchema: { type: "object" } }] });
          else if (msg.method === "tools/call") reply({ content: [{ type: "text", text: "pong" }] });
        }
      });
    `;
    const transport = createStdioTransport(process.execPath, ["-e", serverScript], {});
    try {
      const conn = await connectServer("smoke", { ...CFG, id: "smoke" }, transport, { timeoutMs: 10_000 });
      expect(conn.status).toBe("ready");
      expect(conn.tools.map((t) => t.name)).toEqual(["ping"]);
      const result = await callTool(conn, "ping", {}, { timeoutMs: 10_000 });
      expect(result.isError).toBe(false);
      expect(JSON.stringify(result.output)).toContain("pong");
    } finally {
      transport.close();
    }
  }, 30_000);
});