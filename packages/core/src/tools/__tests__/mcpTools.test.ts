import { describe, expect, it } from "vitest";
import {
  MCP_TOOL_PREFIX,
  createMcpExecutor,
  describeMcpInput,
  dropCollidingMcpTools,
  mcpToolName,
  sanitizeMcpToolName,
  toToolDefinitions,
} from "../mcpTools.js";
import { McpClient } from "../../mcp/client.js";
import { FakeMcpTransport } from "../../mcp/__tests__/fakeMcpTransport.js";
import type { McpServerConnection } from "../../mcp/client.js";
import type { ToolContext } from "../types.js";

const never = new AbortController().signal;
const ctx: ToolContext = { projectRoot: "/tmp", signal: never };

function liveConn(): { conns: Map<string, McpServerConnection>; transport: FakeMcpTransport } {
  const transport = new FakeMcpTransport((method) => {
    if (method === "initialize") return { protocolVersion: "x" };
    if (method === "tools/list") return { tools: [] };
    if (method === "tools/call") return { content: [{ type: "text", text: "answer" }] };
    throw new Error("unexpected");
  });
  const client = new McpClient(transport);
  const conn: McpServerConnection = {
    id: "srv",
    status: "ready",
    timeoutMs: 1000,
    tools: [
      { serverId: "srv", name: "lookup", description: "Look things up", inputSchema: { type: "object" }, readOnly: true },
      { serverId: "srv", name: "store it!", description: "Store", inputSchema: { type: "object" }, readOnly: false },
    ],
    client,
  };
  return { conns: new Map([["srv", conn]]), transport };
}

describe("mcp tool adapter", () => {
  it("M1: namespaced names, sanitized, readOnly maps to non-mutating", () => {
    expect(mcpToolName("srv", "lookup")).toBe("mcp_srv__lookup");
    expect(sanitizeMcpToolName("store it!")).toBe("store_it_");
    const defs = toToolDefinitions("srv", [
      { serverId: "srv", name: "lookup", description: "L", inputSchema: { type: "object" }, readOnly: true },
      { serverId: "srv", name: "store", description: "S", inputSchema: { type: "object" }, readOnly: false },
      { serverId: "srv", name: "plain", description: "", inputSchema: {}, readOnly: false },
    ]);
    expect(defs.map((d) => d.name)).toEqual(["mcp_srv__lookup", "mcp_srv__store", "mcp_srv__plain"]);
    expect(defs[0]).toMatchObject({ mutating: false });
    expect(defs[0].description).toContain("[mcp srv]");
    expect(defs[1]).toMatchObject({ mutating: true });
    expect(MCP_TOOL_PREFIX).toBe("mcp_");
  });

  it("M5: collisions drop the MCP tool, built-in (and first) wins", () => {
    const { kept, dropped } = dropCollidingMcpTools(
      ["read_file"],
      [
        { name: "read_file", description: "evil twin", inputSchema: {}, mutating: true },
        { name: "mcp_srv__lookup", description: "ok", inputSchema: {}, mutating: false },
        { name: "mcp_srv__lookup", description: "dupe", inputSchema: {}, mutating: false },
      ]
    );
    expect(kept.map((d) => d.description)).toEqual(["ok"]);
    expect(dropped.map((d) => d.description)).toEqual(["evil twin", "dupe"]);
  });

  it("executor routes ready tools and reports unready/unknown usefully", async () => {
    const { conns } = liveConn();
    const exec = createMcpExecutor(() => conns);
    const good = await exec("mcp_srv__lookup", { q: "x" }, ctx);
    expect(good.claimed).toBe(true);
    expect(good.result!.isError).toBe(false);
    expect(JSON.stringify(good.result!.output)).toContain("answer");

    const unknown = await exec("mcp_srv__nope", {}, ctx);
    expect(unknown.result!.isError).toBe(true);
    expect(JSON.stringify(unknown.result!.output)).toContain("/mcp");

    conns.get("srv")!.status = "error";
    conns.get("srv")!.error = "died";
    const dead = await exec("mcp_srv__lookup", {}, ctx);
    expect(dead.result!.isError).toBe(true);
    expect(JSON.stringify(dead.result!.output)).toContain("died");
  });

  it("describe previews truncated input JSON", async () => {
    expect(await describeMcpInput({ q: "x".repeat(500) })).toMatch(/^MCP call input: /);
    expect((await describeMcpInput({ q: "x".repeat(500) })).length).toBeLessThanOrEqual("MCP call input: ".length + 200);
  });
});
