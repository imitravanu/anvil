import { useEffect, useState } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import type { PendingPermissionRequest } from "../permission/TuiPermissionBroker.js";
import { ColorizedDiff } from "../diff/colorizeDiff.js";
import { useTheme } from "../theme/theme.js";
import { curtail } from "../util/format.js";

const DIFF_TOOLS = new Set(["edit_file", "write_file"]);

// active phrasing instead of the awkward tool-name split.
const TOOL_LABELS: Record<string, string> = {
  edit_file: "wants to edit a file",
  write_file: "wants to write a file",
  run_command: "wants to run a command",
};

function optionsFor(toolName: string): string[] {
  return ["Allow once", `Always allow '${toolName}' this session`, "Deny"];
}

/**
 * U11 slice: MCP tools arrive as `mcp_<server>__<tool>`. Surface the server
 * identity in the prompt so external-tool consent is informed — the summary
 * alone ("MCP call input: …") never named the process receiving the input.
 */
export function mcpServerOf(toolName: string): { server: string; tool: string } | null {
  if (!toolName.startsWith("mcp_")) return null;
  const rest = toolName.slice("mcp_".length);
  const sep = rest.indexOf("__");
  if (sep <= 0 || sep === rest.length - 2) return null;
  return { server: rest.slice(0, sep), tool: rest.slice(sep + 2) };
}

/**
 * Modal-style permission overlay. Takes over keyboard input while visible —
 * App renders it IN PLACE of InputBar, so keystrokes can't leak through.
 */
export function PermissionPrompt({
  request,
  broker,
}: {
  request: PendingPermissionRequest;
  broker: { approveAlwaysForSession(toolName: string): void };
}) {
  const theme = useTheme();
  const [selected, setSelected] = useState(0);
  // A new queued request reuses this overlay: reset the highlight so a
  // fast Enter can never confirm the previous request's selection (Allow
  // on a dangerous tool, or Deny on a benign one) without the user looking.
  useEffect(() => {
    setSelected(0);
  }, [request]);
  const options = optionsFor(request.toolName);
  const isDiff = DIFF_TOOLS.has(request.toolName);

  useInput((_input, key) => {
    if (key.escape) {
      // Esc = Deny: the overlay must always be escapable with one key,
      // matching every other overlay's Esc-to-dismiss contract.
      request.resolve(false);
      return;
    }
    if (key.upArrow) setSelected((s) => Math.max(0, s - 1));
    else if (key.downArrow) setSelected((s) => Math.min(options.length - 1, s + 1));
    else if (key.return) {
      if (selected === 0) request.resolve(true);
      else if (selected === 1) {
        broker.approveAlwaysForSession(request.toolName);
        request.resolve(true);
      } else request.resolve(false);
    }
  });

  const mcp = mcpServerOf(request.toolName);
  const label = mcp
    ? `wants to run external tool ${mcp.tool}`
    : (TOOL_LABELS[request.toolName] ?? `wants to ${request.toolName.replace(/_/g, " ")}`);
  const { stdout } = useStdout();
  // Command summaries are model-authored — a 500-char one-liner would wrap to
  // a dozen rows inside this flexShrink={0} overlay and overflow the frame.
  // The diff path bounds itself in ColorizedDiff; bound the text path here.
  const maxText = Math.max(20, (stdout?.columns ?? 80) - 8);

  return (
    <Box
      flexDirection="column"
      flexShrink={0}
      borderStyle="round"
      borderColor={theme.colors.toolRunning}
      paddingX={1}
    >
      <Text color={theme.colors.toolName}>
        ⚠ {mcp ? (
          <>
            <Text color={theme.colors.accent}>[mcp:{mcp.server}]</Text> {mcp.tool}
          </>
        ) : (
          request.toolName
        )}{" "}
        <Text color={theme.colors.userText}>{label}</Text>
      </Text>
      {mcp && (
        <Text dimColor>External process — anything sent (file contents included) is visible to that server.</Text>
      )}
      <Box marginTop={0} marginBottom={1}>
        {isDiff ? (
          <ColorizedDiff diff={request.summary} />
        ) : (
          <Text color={theme.colors.assistantText}>{curtail(request.summary, maxText * 3)}</Text>
        )}
      </Box>
      {options.map((option, i) => (
        <Text key={option} color={i === selected ? theme.colors.primary : undefined}>
          {i === selected ? "❯ " : "  "}
          {option}
        </Text>
      ))}
      <Text dimColor> ↑/↓ to move · Enter to confirm · Esc to deny</Text>
    </Box>
  );
}