import { Box, Text, useStdout } from "ink";
import type { DisplayToolCall } from "../hooks/useAgentController.js";
import { useTheme } from "../theme/theme.js";
import { TOOL_SUMMARY_MAX } from "../util/displayLimits.js";
import { curtail } from "../util/format.js";
import { sanitizeTerminalText } from "../util/sanitize.js";
import { formatToolOutput } from "../util/toolOutput.js";
import { useSpinnerFrame } from "../util/useSpinner.js";
import { ExpandedLines } from "./ExpandedLines.js";

function describeCall(call: DisplayToolCall): string {
  // Summaries and JSON inputs are single-lined via curtail (code-point aware —
  // a naive slice could split a surrogate pair). Sanitize FIRST: tool output
  // carries \r progress lines and ANSI codes that corrupt the frame.
  if (call.summary) {
    return curtail(sanitizeTerminalText(call.summary).split("\n")[0] ?? "", TOOL_SUMMARY_MAX);
  }
  return curtail(JSON.stringify(call.input), TOOL_SUMMARY_MAX);
}

export function ToolCallView({ call, expanded }: { call: DisplayToolCall; expanded?: boolean }) {
  const theme = useTheme();
  const { stdout } = useStdout();
  const spinner = useSpinnerFrame(call.status === "running");
  const symbol =
    call.status === "running" ? spinner : call.status === "done" ? "✓" : call.status === "cancelled" ? "○" : "✗";
  // DW-2.2 status pills on semantic tokens (values match the legacy tool
  // colors on dark, diverge purposefully on midnight/hacker).
  const color =
    call.status === "running"
      ? theme.colors.warning
      : call.status === "done"
        ? theme.colors.success
        : call.status === "cancelled"
          ? theme.colors.textMuted
          : theme.colors.error;
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
