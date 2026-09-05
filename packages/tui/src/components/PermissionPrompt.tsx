import { useState } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import type { PendingPermissionRequest } from "../permission/TuiPermissionBroker.js";
import { ColorizedDiff } from "../diff/colorizeDiff.js";
import { useTheme } from "../theme/theme.js";

const DIFF_TOOLS = new Set(["edit_file", "write_file"]);

// Phase 8 (C5): active phrasing instead of the awkward tool-name split.
const TOOL_LABELS: Record<string, string> = {
  edit_file: "wants to edit a file",
  write_file: "wants to write a file",
  run_command: "wants to run a command",
};

function optionsFor(toolName: string): string[] {
  return ["Allow once", `Always allow '${toolName}' this session`, "Deny"];
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

  const label = TOOL_LABELS[request.toolName] ?? `wants to ${request.toolName.replace(/_/g, " ")}`;

  return (
    <Box
      flexDirection="column"
      flexShrink={0}
      borderStyle="round"
      borderColor={theme.colors.toolRunning}
      paddingX={1}
    >
      <Text color={theme.colors.toolName}>
        ⚠ {request.toolName}{" "}
        <Text color={theme.colors.userText}>{label}</Text>
      </Text>
      <Box marginTop={0} marginBottom={1}>
        {isDiff ? (
          <ColorizedDiff diff={request.summary} />
        ) : (
          <Text color={theme.colors.assistantText}>{request.summary}</Text>
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