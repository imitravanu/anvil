import { Box, Text } from "ink";
import type { DisplaySubAgent } from "../hooks/useAgentController.js";
import { useTheme } from "../theme/theme.js";
import { capReportLines, formatSubAgentLine } from "../util/subagent.js";

/**
 * U10 sub-agent card: collapsed one-liner always, report body under /expand.
 * Reports already finished render even while the turn streams (they arrived
 * as complete events); running cards show live until finished/cancelled.
 */
export function SubAgentView({ sub, expanded }: { sub: DisplaySubAgent; expanded?: boolean }) {
  const theme = useTheme();
  const color =
    sub.status === "running"
      ? theme.colors.toolRunning
      : sub.status === "done"
        ? theme.colors.toolDone
        : theme.colors.toolError;
  return (
    <Box flexDirection="column">
      <Box paddingLeft={3}>
        <Text color={color}>{formatSubAgentLine(sub)}</Text>
      </Box>
      {expanded && sub.status === "done" && (
        <Box paddingLeft={5} flexDirection="column">
          {capReportLines(sub.report).map((line, i) => (
            <Text key={i} dimColor>
              {line}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  );
}
