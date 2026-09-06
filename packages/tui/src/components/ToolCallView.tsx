import { Box, Text, useStdout } from "ink";
import type { DisplayToolCall } from "../hooks/useAgentController.js";
import { useTheme } from "../theme/theme.js";
import { TOOL_SUMMARY_MAX } from "../util/displayLimits.js";
import { curtail } from "../util/format.js";
import { formatToolOutput } from "../util/toolOutput.js";
import { useSpinnerFrame } from "../util/useSpinner.js";
import { ExpandedLines } from "./ExpandedLines.js";

function describeCall(call: DisplayToolCall): string {
  // Summaries and JSON inputs are single-lined via curtail (code-point aware —
  // a naive slice could split a surrogate pair).
  if (call.summary) return curtail(call.summary.split("\n")[0] ?? "", TOOL_SUMMARY_MAX);
  return curtail(JSON.stringify(call.input), TOOL_SUMMARY_MAX);
}

export function ToolCallView({ call, expanded }: { call: DisplayToolCall; expanded?: boolean }) {
  const theme = useTheme();
  const { stdout } = useStdout();
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
  // The composed one-liner must fit one terminal row — it is a card title, and
  // wrapping it adds transcript rows the scrollback estimator never counts.
  const line = `${symbol} ${call.name} ${describeCall(call)}`;
  return (
    <Box flexDirection="column">
      <Box paddingLeft={3}>
        <Text color={color}>{curtail(line, Math.max(20, (stdout?.columns ?? 80) - 4))}</Text>
      </Box>
      {expanded && call.status !== "running" && (
        <ExpandedLines lines={formatToolOutput(call.output)} />
      )}
    </Box>
  );
}
