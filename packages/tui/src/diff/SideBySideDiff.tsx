import React from "react";
import { Box, Text, useStdout } from "ink";
import { parseDiff } from "./parseDiff.js";
import { pairSideRows } from "./sideBySide.js";
import { useTheme } from "../theme/theme.js";
import { curtail } from "../util/format.js";
import { MAX_DIFF_ROWS } from "./colorizeDiff.js";

/**
 * DW-4.5 — side-by-side diff for wide terminals. Before | After columns with
 * line numbers; banners span both. Long lines curtail per column so pairs
 * never wrap out of alignment. Row-capped like ColorizedDiff.
 */
export function SideBySideDiff({
  diff,
  maxRows,
}: {
  diff: string;
  maxRows?: number;
}) {
  const theme = useTheme();
  const { stdout } = useStdout();
  const width = stdout?.columns ?? 80;
  const termRows = stdout?.rows ?? 24;
  // Frame (2) + padding (2) + middle divider (3); split the rest evenly.
  const colWidth = Math.max(20, Math.floor((width - 7) / 2));
  const textWidth = Math.max(10, colWidth - 8);
  const effectiveMaxRows = Math.max(3, Math.min(MAX_DIFF_ROWS, maxRows ?? termRows - 15));
  const parsed = React.useMemo(() => parseDiff(diff), [diff]);
  const paired = React.useMemo(() => pairSideRows(parsed), [parsed]);
  const visible = paired.slice(0, effectiveMaxRows);
  const omitted = paired.length - visible.length;

  const cellColor = (tone: string): string | undefined => {
    if (tone === "add") return theme.colors.toolDone;
    if (tone === "del") return theme.colors.toolError;
    return undefined;
  };

  return (
    <Box flexDirection="column">
      <Box flexShrink={0}>
        <Box width={colWidth} flexShrink={0}>
          <Text bold color={theme.colors.textSecondary}>
            {curtail("Before", textWidth)}
          </Text>
        </Box>
        <Text color={theme.colors.separator}> │ </Text>
        <Box width={colWidth} flexShrink={0}>
          <Text bold color={theme.colors.textSecondary}>
            {curtail("After", textWidth)}
          </Text>
        </Box>
      </Box>
      {visible.map((row, i) => {
        const key = `${i}`;
        if (row.kind === "banner") {
          const color =
            row.tone === "hunk" ? theme.colors.accent : undefined;
          return (
            <Text key={key} dimColor={row.tone !== "hunk"} color={color}>
              {curtail(row.text, colWidth * 2)}
            </Text>
          );
        }
        const leftNo = row.left.lineNo === null ? "    " : String(row.left.lineNo).padStart(4, " ");
        const rightNo = row.right.lineNo === null ? "    " : String(row.right.lineNo).padStart(4, " ");
        return (
          <Box key={key} flexShrink={0}>
            <Box width={colWidth} flexShrink={0}>
              <Text dimColor>{leftNo} </Text>
              <Text color={cellColor(row.left.tone)}>{curtail(row.left.text, textWidth)}</Text>
            </Box>
            <Text color={theme.colors.separator}> │ </Text>
            <Box width={colWidth} flexShrink={0}>
              <Text dimColor>{rightNo} </Text>
              <Text color={cellColor(row.right.tone)}>{curtail(row.right.text, textWidth)}</Text>
            </Box>
          </Box>
        );
      })}
      {omitted > 0 && <Text dimColor>… {omitted} more diff row(s) omitted</Text>}
    </Box>
  );
}
