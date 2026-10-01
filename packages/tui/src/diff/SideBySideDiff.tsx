import React from "react";
import { Box, Text, useStdout } from "ink";
import { parseDiff } from "./parseDiff.js";
import { pairSideRows } from "./sideBySide.js";
import { useTheme } from "../theme/theme.js";
import { curtailToCells } from "../util/format.js";
import { MAX_DIFF_ROWS } from "./colorizeDiff.js";

/** Below this, two code columns cannot be read — callers must use unified. */
export const SIDE_BY_SIDE_MIN_COLUMNS = 60;
/** DW-4.5 auto-enable threshold: wide terminals get side-by-side by default. */
export const SIDE_BY_SIDE_AUTO_COLUMNS = 120;

/** Whether a side-by-side layout is legible at this terminal width. */
export function sideBySideFits(termColumns: number): boolean {
  return termColumns >= SIDE_BY_SIDE_MIN_COLUMNS;
}

/**
 * F6 (AUDIT-2026-09-30): the columns must never reserve more cells than the
 * terminal has. The old `Math.max(20, …)` floor forced a 43-cell minimum that
 * overflowed the documented 40×15 target. The only fixed costs are the modal's
 * frame (2 borders + 2 padding) and the 3-cell divider — 7 in total.
 */
export function sideBySideLayout(termColumns: number): { colWidth: number; textWidth: number } {
  const colWidth = Math.max(1, Math.floor((termColumns - 7) / 2));
  // Line-number gutter takes 4 cells plus a space.
  return { colWidth, textWidth: Math.max(1, colWidth - 5) };
}

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
  const { colWidth, textWidth } = sideBySideLayout(width);
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

  // Phase 28.2: per-cell tint, so the added/deleted column reads as a lane
  // even when the paired row has a different tone on each side.
  const cellBg = (tone: string): string | undefined => {
    if (tone === "add") return theme.colors.diffAddBg;
    if (tone === "del") return theme.colors.diffDelBg;
    return undefined;
  };

  return (
    <Box flexDirection="column">
      <Box flexShrink={0}>
        <Box width={colWidth} flexShrink={0}>
          <Text bold color={theme.colors.textSecondary}>
            {curtailToCells("Before", textWidth)}
          </Text>
        </Box>
        <Text color={theme.colors.separator}> │ </Text>
        <Box width={colWidth} flexShrink={0}>
          <Text bold color={theme.colors.textSecondary}>
            {curtailToCells("After", textWidth)}
          </Text>
        </Box>
      </Box>
      {visible.map((row, i) => {
        const key = `${i}`;
        if (row.kind === "banner") {
          const color =
            row.tone === "hunk" ? theme.colors.accent : theme.colors.textSecondary;
          return (
            <Text key={key} color={color}>
              {curtailToCells(row.text, colWidth * 2)}
            </Text>
          );
        }
        const leftNo = row.left.lineNo === null ? "    " : String(row.left.lineNo).padStart(4, " ");
        const rightNo = row.right.lineNo === null ? "    " : String(row.right.lineNo).padStart(4, " ");
        // Ink's Box takes no backgroundColor (only Text does), so the tint rides
        // each cell's own glyphs: line number + code. Context rows stay untinted.
        const leftBg = cellBg(row.left.tone);
        const rightBg = cellBg(row.right.tone);
        return (
          <Box key={key} flexShrink={0}>
            <Box width={colWidth} flexShrink={0}>
              <Text color={theme.colors.textMuted} backgroundColor={leftBg}>{leftNo} </Text>
              <Text color={cellColor(row.left.tone)} backgroundColor={leftBg}>{curtailToCells(row.left.text, textWidth)}</Text>
            </Box>
            <Text color={theme.colors.separator}> │ </Text>
            <Box width={colWidth} flexShrink={0}>
              <Text color={theme.colors.textMuted} backgroundColor={rightBg}>{rightNo} </Text>
              <Text color={cellColor(row.right.tone)} backgroundColor={rightBg}>{curtailToCells(row.right.text, textWidth)}</Text>
            </Box>
          </Box>
        );
      })}
      {omitted > 0 && <Text color={theme.colors.textSecondary}>… {omitted} more diff row(s) omitted</Text>}
    </Box>
  );
}
