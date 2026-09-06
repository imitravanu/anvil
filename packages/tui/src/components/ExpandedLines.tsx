import { Box, Text, useStdout } from "ink";
import { curtail } from "../util/format.js";

/** Expanded body block shared by ToolCallView/SubAgentView. */
export function ExpandedLines({ lines }: { lines: string[] }) {
  const { stdout } = useStdout();
  // A single 10 KB minified/JSON line counts as 1 capped line but renders as
  // ~125 visual rows and blows the fixed frame (the stacking-overlap bug).
  // Curtail per-line to terminal width so expanded output can never do that.
  const maxLen = Math.max(20, (stdout?.columns ?? 80) - 8);
  return (
    <Box paddingLeft={5} flexDirection="column">
      {lines.map((line, i) => (
        <Text key={i} dimColor wrap="wrap">
          {curtail(line, maxLen)}
        </Text>
      ))}
    </Box>
  );
}
