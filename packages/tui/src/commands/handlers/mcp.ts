import { collectMcpToolDefs, TOOL_DEFINITIONS, getErrorMessage } from "@anvil/core";
import type { CommandHandlerDeps } from "../types.js";
import { formatMcpStatus } from "../../util/mcp.js";

export function handleMcp(deps: CommandHandlerDeps, sub?: string): void {
  const { mcp, printSystemMessage, isBusy, session } = deps;
  const conns = mcp?.list() ?? [];
  const notices = mcp?.notices ?? [];
  if (sub === undefined || sub === "status") {
    printSystemMessage(formatMcpStatus(conns, notices));
    return;
  }
  if (sub === "reconnect") {
    if (isBusy) {
      printSystemMessage("Cannot reconnect MCP servers while a turn is in flight.");
      return;
    }
    if (!mcp) {
      printSystemMessage(formatMcpStatus([], notices));
      return;
    }
    printSystemMessage("Reconnecting MCP servers...");
    void mcp.reconnect().then((report) => {
      const kept = collectMcpToolDefs(
        mcp.list(),
        TOOL_DEFINITIONS.map((d) => d.name)
      );
      let hotReloaded = "";
      try {
        session.setTools([...TOOL_DEFINITIONS, ...kept]);
        hotReloaded = ` ${kept.length} MCP tool(s) live in this session.`;
      } catch (err: unknown) {
        hotReloaded = ` (Tools NOT hot-loaded: ${getErrorMessage(err)})`;
      }
      const fresh = [...notices, ...report.problems.map((p) => `MCP ${p}`)];
      printSystemMessage(
        `Reconnected: ${report.connected} server(s), ${report.tools} tool(s).` +
        `${hotReloaded}\n` +
        formatMcpStatus(mcp.list(), fresh)
      );
    }).catch((err: unknown) => {
      printSystemMessage(`MCP reconnect failed: ${getErrorMessage(err)}`);
    });
    return;
  }
  printSystemMessage(`Unknown /mcp subcommand: ${sub}. Try /mcp or /mcp reconnect.`);
}
