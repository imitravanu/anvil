import type { McpServerConnection } from "@anvil/core";

/** U11 server health: /mcp status output. Pure — App just prints it. */
export function formatMcpStatus(
  conns: readonly McpServerConnection[],
  notices: readonly string[] = []
): string {
  const lines: string[] = [];
  if (notices.length > 0) {
    for (const n of notices) lines.push(`⚠ ${n}`);
  }
  if (conns.length === 0) {
    lines.push("No MCP servers configured. Add some to ~/.anvil/mcp.json (set ANVIL_HOME to relocate).");
    lines.push("Shell commands and local file writes are unaffected. Only file writes rewind.");
    return lines.join("\n");
  }
  for (const c of conns) {
    if (c.status === "ready") {
      lines.push(`✓ ${c.id}: ready — ${c.tools.length} tool${c.tools.length === 1 ? "" : "s"}`);
    } else if (c.status === "misconfigured") {
      lines.push(`✗ ${c.id}: misconfigured — ${c.error ?? "see mcp.json"}`);
    } else {
      lines.push(`✗ ${c.id}: error — ${c.error ?? "connection failed"} (tools unavailable)`);
    }
  }
  lines.push("Only local file writes rewind — MCP and shell actions can't be undone.");
  return lines.join("\n");
}
