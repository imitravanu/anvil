import React from "react";
import { Box, Text } from "ink";

/**
 * Renders a unified diff string as colored Ink <Text> lines:
 * additions green, removals red, hunk headers cyan, context dimmed.
 */
export function ColorizedDiff({ diff }: { diff: string }) {
  const lines = diff.split("\n");
  return (
    <Box flexDirection="column">
      {lines.map((line, i) => {
        let color: string | undefined;
        if (line.startsWith("+") && !line.startsWith("+++")) color = "green";
        else if (line.startsWith("-") && !line.startsWith("---")) color = "red";
        else if (line.startsWith("@@")) color = "cyan";
        return (
          <Text key={i} color={color} dimColor={!color}>
            {line}
          </Text>
        );
      })}
    </Box>
  );
}