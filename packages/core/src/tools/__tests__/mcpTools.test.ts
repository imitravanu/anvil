import { describe, expect, it } from "vitest";
import {
  MCP_TOOL_PREFIX,
  splitMcpToolName,
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

  it("M1b: splitMcpToolName resolves the ambiguous separator with known ids", () => {
    // A server id may legally contain `__` (SERVER_ID_RE allows `_`), and so may
    // a sanitized tool name — so the separator alone is ambiguous and the
    // known-id list is what makes the split truthful.
    expect(splitMcpToolName("mcp_my-tools__read_doc", ["my-tools"])).toEqual({
      server: "my-tools",
      tool: "read_doc",
    });
    // Server `my__server`: longest match wins, so the prompt names the server
    // that actually receives the call instead of a nonexistent `my`.
    expect(splitMcpToolName("mcp_my__server__read_doc", ["my", "my__server"])).toEqual({
      server: "my__server",
      tool: "read_doc",
    });
    // Tool names keep `__` too; with no known ids the first separator splits.
    expect(splitMcpToolName("mcp_srv__read__doc")).toEqual({ server: "srv", tool: "read__doc" });
    expect(splitMcpToolName("edit_file", ["srv"])).toBeNull();
    expect(splitMcpToolName("mcp_noseparator", ["srv"])).toBeNull();
    expect(splitMcpToolName("mcp_srv__", ["srv"])).toBeNull();
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

  it("describe previews parameters list with bullet points", async () => {
    const res = await describeMcpInput({ query: "SELECT * FROM users", limit: 10 });
    expect(res).toContain("Parameters:\n");
    expect(res).toContain("  • query: \"SELECT * FROM users\"");
    expect(res).toContain("  • limit: 10");
  });

  it("describe handles empty objects, primitives, and truncates long values", async () => {
    expect(await describeMcpInput({})).toBe("Parameters: (none)");
    expect(await describeMcpInput(null)).toBe("Parameters: (none)");
    const long = await describeMcpInput({ q: "x".repeat(500) });
    expect(long).toContain("Parameters:\n  • q: ");
    expect(long).toContain("…");
    expect(long.length).toBeLessThan(300);
  });
});

