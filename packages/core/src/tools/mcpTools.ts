import type { ToolDefinition } from "./types.js";
import type { ExternalToolExecutor } from "./index.js";
import type { McpServerConnection, McpToolDef } from "../mcp/client.js";
import { callTool } from "../mcp/client.js";

// ---------------------------------------------------------------------------
// MCP tool adapter: namespaced definitions + dispatch.
// 3.
// ---------------------------------------------------------------------------

export const MCP_TOOL_PREFIX = "mcp_";

/** Sanitize an MCP tool name into the provider-safe alphabet. */
export function sanitizeMcpToolName(name: string): string {
  const clean = name.replace(/[^a-zA-Z0-9_-]/g, "_");
  return clean.length > 0 ? clean : "unnamed";
}

export function mcpToolName(serverId: string, toolName: string): string {
  return `${MCP_TOOL_PREFIX}${serverId}__${sanitizeMcpToolName(toolName)}`;
}

/**
 * Convert server tools to session ToolDefinitions. Unknown external tools
 * are mutating BY DEFAULT (permission prompts gate them) unless the server
 * marks readOnlyHint — the safe direction ( decision log).
 */
export function toToolDefinitions(serverId: string, tools: McpToolDef[]): ToolDefinition[] {
  return tools.map((t) => ({
    name: mcpToolName(serverId, t.name),
    description: `[mcp ${serverId}] ${t.description}`,
    inputSchema:
      t.inputSchema && typeof t.inputSchema === "object" ? t.inputSchema : { type: "object", properties: {} },
    mutating: t.readOnly !== true,
  }));
}

/**
 * Drop MCP definitions that collide with built-in tool names (built-in wins,
 * first-in-list wins among MCP). Returns kept + dropped for startup warnings.
 */
export function dropCollidingMcpTools(
  builtInNames: readonly string[],
  mcpDefs: ToolDefinition[]
): { kept: ToolDefinition[]; dropped: ToolDefinition[] } {
  const seen = new Set<string>(builtInNames);
  const kept: ToolDefinition[] = [];
  const dropped: ToolDefinition[] = [];
  for (const def of mcpDefs) {
    if (seen.has(def.name)) {
      dropped.push(def);
    } else {
      seen.add(def.name);
      kept.push(def);
    }
  }
  return { kept, dropped };
}

/**
 * Permission-prompt preview for MCP calls: server-qualified input JSON.
 * The model already receives the full JSON schema via the provider
 * adapters; the human sees the tool name plus truncated input.
 */
export function describeMcpInput(input: unknown): Promise<string> {
  return Promise.resolve(`MCP call input: ${JSON.stringify(input).slice(0, 200)}`);
}

/**
 * Build an executor over live connections. Resolution scans ready
 * connections' tool lists per call (counts are small) — reconnects that
 * rebuild the connection map automatically refresh routing, no stale map.
 * Namespaced names that resolve nowhere return an isError result pointing
 * at /mcp reconnect (better UX than the generic unknown-tool error).
 */
export function createMcpExecutor(
  getConnections: () => Map<string, McpServerConnection>
): ExternalToolExecutor {
  return async (name, input, ctx) => {
    const conns = getConnections();
    for (const conn of conns.values()) {
      const tool = conn.tools.find((t) => mcpToolName(conn.id, t.name) === name);
      if (!tool) continue;
      if (conn.status !== "ready") {
        return {
          claimed: true,
          result: {
            output: { error: `MCP server "${conn.id}" is not ready${conn.error ? `: ${conn.error}` : ""}. Run /mcp reconnect.` },
            isError: true,
            summary: `MCP server "${conn.id}" unavailable.`,
          },
        };
      }
      const call = await callTool(conn, tool.name, input, { signal: ctx.signal });
      return {
        claimed: true,
        result: {
          output: call.output,
          isError: call.isError,
          summary: call.isError
            ? `MCP tool ${name} failed.`
            : `MCP tool ${name} finished.`,
        },
      };
    }
    return {
      claimed: true,
      result: {
        output: { error: `Unknown MCP tool "${name}". Run /mcp to list servers, /mcp reconnect to refresh.` },
        isError: true,
        summary: `Unknown MCP tool: ${name}.`,
      },
    };
  };
}
