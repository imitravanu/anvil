import { Box, Text, useStdout } from "ink";
import type { DisplaySubAgent } from "../hooks/useAgentController.js";
import { useTheme } from "../theme/theme.js";
import { curtail } from "../util/format.js";
import { capReportLines, formatSubAgentLine } from "../util/subagent.js";
import { ExpandedLines } from "./ExpandedLines.js";

/**
 * Sub-agent card: collapsed one-liner always, report body under /expand.
 * Reports already finished render even while the turn streams (they arrived
 * as complete events); running cards show live until finished/cancelled.
 */
export function SubAgentView({ sub, expanded }: { sub: DisplaySubAgent; expanded?: boolean }) {
  const theme = useTheme();
  const { stdout } = useStdout();
  const color =
    sub.status === "running"
      ? theme.colors.toolRunning
      : sub.status === "done"
        ? theme.colors.toolDone
        : theme.colors.toolError;
  // One row per card, like ToolCallView — a wrapped title desyncs the
  // scrollback estimator (row stacking).
  const line = curtail(formatSubAgentLine(sub), Math.max(20, (stdout?.columns ?? 80) - 4));
  return (
    <Box flexDirection="column">
      <Box paddingLeft={3}>
        <Text color={color}>{line}</Text>
      </Box>
      {expanded && sub.status === "done" && (
        <ExpandedLines lines={capReportLines(sub.report)} />
      )}
    </Box>
  );
}
