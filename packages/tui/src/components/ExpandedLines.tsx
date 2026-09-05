import { Box, Text } from "ink";

/** Expanded body block shared by ToolCallView/SubAgentView. */
export function ExpandedLines({ lines }: { lines: string[] }) {
  return (
    <Box paddingLeft={5} flexDirection="column">
      {lines.map((line, i) => (
        <Text key={i} dimColor>
          {line}
        </Text>
      ))}
    </Box>
  );
}
