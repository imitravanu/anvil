import { Box, Text } from "ink";
import type { DisplayToolCall } from "../hooks/useAgentController.js";
import { useTheme } from "../theme/theme.js";
import { TOOL_SUMMARY_MAX } from "../util/displayLimits.js";
import { formatToolOutput } from "../util/toolOutput.js";
import { useSpinnerFrame } from "../util/useSpinner.js";
import { ExpandedLines } from "./ExpandedLines.js";

function oneLine(text: string, max = TOOL_SUMMARY_MAX): string {
  const first = text.split("\n")[0] ?? "";
  return first.length > max ? first.slice(0, max - 1) + "…" : first;
}

function describeCall(call: DisplayToolCall): string {
  if (call.summary) return oneLine(call.summary);
  return oneLine(JSON.stringify(call.input));
}

export function ToolCallView({ call, expanded }: { call: DisplayToolCall; expanded?: boolean }) {
  const theme = useTheme();
  const spinner = useSpinnerFrame(call.status === "running");
  const symbol =
    call.status === "running" ? spinner : call.status === "done" ? "✓" : call.status === "cancelled" ? "○" : "✗";
  const color =
    call.status === "running"
      ? theme.colors.toolRunning
      : call.status === "done"
        ? theme.colors.toolDone
        : call.status === "cancelled"
          ? theme.colors.dim
          : theme.colors.toolError;
  return (
    <Box flexDirection="column">
      <Box paddingLeft={3}>
        <Text color={color}>{symbol} </Text>
        <Text color={theme.colors.toolName}>{call.name}</Text>
        <Text dimColor> {describeCall(call)}</Text>
      </Box>
      {expanded && call.status !== "running" && (
        <ExpandedLines lines={formatToolOutput(call.output)} />
      )}
    </Box>
  );
}
