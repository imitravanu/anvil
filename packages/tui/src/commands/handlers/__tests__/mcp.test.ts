import { describe, expect, it } from "vitest";
import {
  collectMcpToolDefs,
  TOOL_DEFINITIONS,
  type McpServerConnection,
  type ToolDefinition,
} from "@anvil/core";
import { handleMcp } from "../mcp.js";
import type { CommandHandlerDeps } from "../../types.js";
import type { McpAppState } from "../../../components/App.js";

const PLUGIN_TOOL: ToolDefinition = {
  name: "my_plugin_tool",
  description: "a plugin-provided tool",
  inputSchema: { type: "object" },
  mutating: true,
};

function conn(id: string, toolNames: string[]): McpServerConnection {
  return {
    id,
    status: "ready",
    timeoutMs: 30_000,
    tools: toolNames.map((name) => ({
      serverId: id,
      name,
      description: "d",
      inputSchema: { type: "object" },
      readOnly: false,
    })),
  };
}

function builtInNames(): string[] {
  return TOOL_DEFINITIONS.map((d) => d.name);
}

/**
 * Boot wires the session's tools as built-ins + plugin tools + MCP
 * (`cli/src/index.tsx`), so the seed here mirrors that composition.
 */
function harness(bootConns: McpServerConnection[], afterReconnect: McpServerConnection[]) {
  let conns = bootConns;
  const messages: string[] = [];
  const session = {
    tools: [...TOOL_DEFINITIONS, PLUGIN_TOOL, ...collectMcpToolDefs(bootConns, builtInNames())],
    getTools(): readonly ToolDefinition[] {
      return session.tools;
    },
    setTools(next: readonly ToolDefinition[]): void {
      session.tools = [...next];
    },
  };
  const mcp: McpAppState = {
    list: () => conns,
    notices: [],
    reconnect: async () => {
      conns = afterReconnect;
      return { problems: [], connected: afterReconnect.length, tools: 1 };
    },
  };
  const deps = {
    session,
    mcp,
    isBusy: false,
    messages: [],
    printSystemMessage: (t: string) => messages.push(t),
  } as unknown as CommandHandlerDeps;
  return { deps, session, messages };
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("handleMcp reconnect", () => {
  it("preserves plugin tools while replacing the MCP tools", async () => {
    // Regression: the handler rebuilt the list as TOOL_DEFINITIONS + MCP only,
    // so a plugin user who ran /mcp reconnect silently lost every plugin tool
    // for the rest of the session (the model could no longer call them).
    const { deps, session } = harness(
      [conn("docs", ["old_fetch"])],
      [conn("docs", ["fetch"])]
    );
    handleMcp(deps, "reconnect");
    await settle();

    const names = session.tools.map((t) => t.name);
    expect(names).toContain(PLUGIN_TOOL.name);
    expect(names).toContain("mcp_docs__fetch");
    expect(names).not.toContain("mcp_docs__old_fetch");
  });

  it("filters stale MCP tools by prefix rather than dropping the whole plugin set", async () => {
    const { deps, session } = harness(
      [conn("a", ["one"]), conn("b", ["two"])],
      [conn("a", ["one"])]
    );
    handleMcp(deps, "reconnect");
    await settle();

    const names = session.tools.map((t) => t.name);
    expect(names).toContain("mcp_a__one");
    expect(names).not.toContain("mcp_b__two"); // server b is gone
    expect(names).toContain(PLUGIN_TOOL.name);
    expect(names.filter((n) => n === PLUGIN_TOOL.name)).toHaveLength(1); // no duplicates
  });
});
