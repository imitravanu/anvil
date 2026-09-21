import type { ToolDefinition } from "./types.js";
import type { ExternalToolExecutor } from "./index.js";
import type { McpServerConnection, McpToolDef } from "../mcp/client.js";
import { callTool } from "../mcp/client.js";

// ---------------------------------------------------------------------------
// MCP tool adapter: namespaced definitions + dispatch.
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
 * Inverse of `mcpToolName`, for DISPLAY only — the executor routes by
 * re-encoding each connection's tools and comparing, so nothing depends on
 * parsing this back.
 *
 * The separator is ambiguous by itself: `SERVER_ID_RE` permits `__` inside a
 * server id and sanitized tool names keep `__` too, so `mcp_a__b__c` is either
 * server `a` / tool `b__c` or server `a__b` / tool `c`. Callers that know the
 * configured ids must pass them, so a permission prompt names the server that
 * actually receives the call; the first-separator fallback is only used when
 * nothing matches (and is what the old inline parser always did, mislabeling
 * any server id containing `__`).
 */
export function splitMcpToolName(
  name: string,
  knownServerIds: readonly string[] = []
): { server: string; tool: string } | null {
  if (!name.startsWith(MCP_TOOL_PREFIX)) return null;
  const rest = name.slice(MCP_TOOL_PREFIX.length);
  // Longest known id wins — a shorter prefix match would truncate `a__b` to `a`.
  let server = "";
  for (const id of knownServerIds) {
    if (id.length > server.length && rest.startsWith(`${id}__`) && rest.length > id.length + 2) {
      server = id;
    }
  }
  if (!server) {
    const sep = rest.indexOf("__");
    if (sep <= 0) return null;
    server = rest.slice(0, sep);
  }
  const tool = rest.slice(server.length + 2);
  return tool.length > 0 ? { server, tool } : null;
}

/**
 * Convert server tools to session ToolDefinitions. Unknown external tools
 * are mutating BY DEFAULT (permission prompts gate them) unless the server
 * marks readOnlyHint — the safe direction.
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
 * Live tool list from every ready MCP connection, with name collisions
 * against the built-in tools dropped. Shared by CLI boot and `/mcp
 * reconnect` so hot-reload builds the list exactly like boot did.
 */
export function collectMcpToolDefs(
  conns: readonly McpServerConnection[],
  baseNames: readonly string[]
): ToolDefinition[] {
  const all = conns.flatMap((c) => (c.status === "ready" ? toToolDefinitions(c.id, c.tools) : []));
  return dropCollidingMcpTools(baseNames, all).kept;
}

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
 * Permission-prompt preview for MCP calls: formatted parameters breakdown.
 * Formats top-level arguments with bullet points for readability instead of a raw JSON blob.
 */
export function describeMcpInput(input: unknown): Promise<string> {
  if (input === null || input === undefined) {
    return Promise.resolve("Parameters: (none)");
  }
  if (typeof input !== "object" || Array.isArray(input)) {
    const serialized = JSON.stringify(input);
    const truncated = serialized.length > 200 ? `${serialized.slice(0, 200)}…` : serialized;
    return Promise.resolve(`Parameters: ${truncated}`);
  }
  const entries = Object.entries(input as Record<string, unknown>);
  if (entries.length === 0) {
    return Promise.resolve("Parameters: (none)");
  }
  const lines = entries.map(([k, v]) => {
    let valStr: string;
    if (typeof v === "string") {
      valStr = v.length > 120 ? `${JSON.stringify(v.slice(0, 120))}…` : JSON.stringify(v);
    } else {
      const raw = JSON.stringify(v);
      valStr = raw.length > 120 ? `${raw.slice(0, 120)}…` : raw;
    }
    return `  • ${k}: ${valStr}`;
  });
  return Promise.resolve(`Parameters:\n${lines.join("\n")}`);
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
