import { useEffect, useState } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import { splitMcpToolName } from "@anvil/core";
import type { PendingPermissionRequest } from "../permission/TuiPermissionBroker.js";
import { ColorizedDiff } from "../diff/colorizeDiff.js";
import { useTheme } from "../theme/theme.js";
import { splitByDisplayWidth } from "../util/format.js";
import { sanitizeTerminalText } from "../util/sanitize.js";

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
 *
 * Delegates to core's `splitMcpToolName` (the codec's single source of truth)
 * and forwards the configured ids, because the separator is ambiguous: a server
 * id or a tool name may itself contain `__`, and naming the wrong process would
 * make this consent prompt actively misleading.
 */
export function mcpServerOf(
  toolName: string,
  knownServerIds: readonly string[] = []
): { server: string; tool: string } | null {
  return splitMcpToolName(toolName, knownServerIds);
}

/**
 * Modal-style permission overlay. Takes over keyboard input while visible —
 * App renders it IN PLACE of InputBar, so keystrokes can't leak through.
 */
export function PermissionPrompt({
  request,
  broker,
  knownServerIds,
}: {
  request: PendingPermissionRequest;
  broker: { approveAlwaysForSession(toolName: string): void };
  /** Configured MCP server ids — resolves `__` inside a server id or tool name. */
  knownServerIds?: readonly string[];
}) {
  const theme = useTheme();
  const [selected, setSelected] = useState(0);
  const [offset, setOffset] = useState(0);
  const { stdout } = useStdout();
  const previewRows = Math.max(1, Math.min(3, (stdout?.rows ?? 24) - 16));
  const previewLines = sanitizeTerminalText(request.summary).split("\n")
    .flatMap(line => splitByDisplayWidth(line, Math.max(1, (stdout?.columns ?? 80) - 8)));
  const maxOffset = Math.max(0, previewLines.length - previewRows);
  const visibleOffset = Math.min(offset, maxOffset);
  // A new queued request reuses this overlay: reset the highlight so a
  // fast Enter can never confirm the previous request's selection (Allow
  // on a dangerous tool, or Deny on a benign one) without the user looking.
  useEffect(() => {
    setSelected(0);
    setOffset(0);
  }, [request]);
  const options = optionsFor(request.toolName);
  const isDiff = DIFF_TOOLS.has(request.toolName);
  // Phase 28.7: file edits keep the full modal because the diff preview is
  // the point; everything else (shell, MCP) gets a single-line y/a/n bar so a
  // routine command doesn't cost three navigation keys.
  const compact = !isDiff;

  useInput((input, key) => {
    // Control shortcuts must never act as affirmative permission keys.
    if (key.ctrl || key.meta) return;
    if (key.escape) {
      // Esc = Deny: the overlay must always be escapable with one key,
      // matching every other overlay's Esc-to-dismiss contract.
      request.resolve(false);
      return;
    }
    if (compact) {
      if (key.upArrow || key.pageUp) {
        setOffset(value => Math.max(0, Math.min(value, maxOffset) - (key.pageUp ? previewRows : 1)));
        return;
      }
      if (key.downArrow || key.pageDown) {
        setOffset(value => Math.min(maxOffset, value + (key.pageDown ? previewRows : 1)));
        return;
      }
      if (input === "g" || input === "G") { setOffset(input === "G" ? maxOffset : 0); return; }
      // Symmetric with diff mode below: Enter is allow-once everywhere, and
      // y/a/n work in both modes (users shouldn't guess which keys this
      // prompt speaks).
      const k = input.toLowerCase();
      if (k === "y" || key.return) request.resolve(true);
      else if (k === "a") {
        broker.approveAlwaysForSession(request.toolName);
        request.resolve(true);
      } else if (k === "n") request.resolve(false);
      return;
    }
    {
      const k = input.toLowerCase();
      if (k === "y") {
        request.resolve(true);
        return;
      }
      if (k === "a") {
        broker.approveAlwaysForSession(request.toolName);
        request.resolve(true);
        return;
      }
      if (k === "n") {
        request.resolve(false);
        return;
      }
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

  const mcp = mcpServerOf(request.toolName, knownServerIds);
  const label = mcp
    ? `wants to run external tool ${mcp.tool}`
    : (TOOL_LABELS[request.toolName] ?? `wants to ${request.toolName.replace(/_/g, " ")}`);
  // Command summaries are model-authored — a 500-char one-liner would wrap to
  // a dozen rows inside this flexShrink={0} overlay and overflow the frame.
  // The diff path bounds itself in ColorizedDiff; bound the text path here.

  return (
    <Box
      flexDirection="column"
      flexShrink={0}
      borderStyle={theme.borders.modal}
      borderColor={theme.colors.warning}
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
        <Text color={theme.colors.textSecondary}>
          External process — anything sent (file contents included) is visible to that server.
        </Text>
      )}
      <Box marginTop={0} marginBottom={1}>
        {isDiff ? (
          <ColorizedDiff diff={request.summary} />
        ) : (
          <Box flexDirection="column">
            <Text color={theme.colors.assistantText}>{previewLines.slice(visibleOffset, visibleOffset + previewRows).join("\n")}</Text>
            {maxOffset > 0 && <Text color={theme.colors.textSecondary}>
              {`Lines ${visibleOffset + 1}–${Math.min(previewLines.length, visibleOffset + previewRows)} of ${previewLines.length} · ↑/↓ scroll · PgUp/PgDn page · g/G start/end`}
            </Text>}
          </Box>
        )}
      </Box>
      {compact ? (
        // Phase 28.7 inline bar — the summary above is the command line; here
        // the three answers sit on one row so y/a/n need no navigation.
        <Box
          flexShrink={0}
          borderStyle={theme.borders.panel}
          borderColor={theme.colors.warning}
          paddingX={1}
        >
          <Text>
            <Text color={theme.colors.accent}>❯ </Text>
            <Text color={theme.colors.textPrimary}>{label}? </Text>
            <Text color={theme.colors.textPrimary} bold>
              y
            </Text>
            <Text color={theme.colors.textSecondary}> allow · </Text>
            <Text color={theme.colors.textPrimary} bold>
              a
            </Text>
            <Text color={theme.colors.textSecondary}> always · </Text>
            <Text color={theme.colors.textPrimary} bold>
              n
            </Text>
            <Text color={theme.colors.textSecondary}> deny · Enter allow</Text>
          </Text>
        </Box>
      ) : (
        <>
          {/* DW-2.3 action buttons: full-width boxes, selected raised in brand. */}
          {options.map((option, i) => (
            <Box
              key={option}
              flexShrink={0}
              borderStyle={theme.borders.panel}
              borderColor={i === selected ? theme.colors.brand : theme.colors.separator}
              paddingX={1}
            >
              <Text color={i === selected ? theme.colors.brand : theme.colors.textSecondary} bold={i === selected}>
                {i === selected ? "▸ " : "  "}
                {option}
              </Text>
            </Box>
          ))}
          <Text color={theme.colors.textSecondary}> ↑/↓ to move · Enter/y to confirm · a always · n/Esc to deny</Text>
        </>
      )}
    </Box>
  );
}
