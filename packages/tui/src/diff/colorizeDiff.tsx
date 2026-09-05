import React from "react";
import { Box, Text, useStdout } from "ink";
import { parseDiff, type DiffRow } from "./parseDiff.js";
import { pairRows, type WordSeg } from "./wordDiff.js";
import { useTheme } from "../theme/theme.js";
import { curtail } from "../util/format.js";

/** Max diff rows rendered in the permission overlay before an omission note. */
export const MAX_DIFF_ROWS = 40;

function gutter(row: DiffRow): string {
  if (row.kind === "add") return `    ${String(row.newNo).padStart(4, " ")} │ `;
  if (row.kind === "del") return `${String(row.oldNo).padStart(4, " ")}     │ `;
  if (row.kind === "context")
    return `${String(row.oldNo).padStart(4, " ")} ${String(row.newNo).padStart(4, " ")} │ `;
  return "";
}

function WordText({ segs, base }: { segs: WordSeg[]; base: string }) {
  return (
    <Text>
      {segs.map((s, i) =>
        s.changed ? (
          <Text key={i} color={base} bold inverse>
            {s.text}
          </Text>
        ) : (
          <Text key={i} color={base}>
            {s.text}
          </Text>
        )
      )}
    </Text>
  );
}

/**
 * U5 richer diffs (+P1: theme-mapped colors, width-aware line curtail).
 * Colors come from the active theme (custom themes work); long lines are
 * curtailed to the terminal width so unbroken code lines can't overflow
 * narrow terminals. Same props as before — PermissionPrompt needs no changes.
 */
export function ColorizedDiff({ diff }: { diff: string }) {
  const theme = useTheme();
  const { stdout } = useStdout();
  const width = stdout?.columns ?? 80;
  const termRows = stdout?.rows ?? 24;
  // Overlay frame (border + padding) eats ~6 columns; gutter eats ~12.
  const maxText = Math.max(20, width - 20);
  // The permission overlay must fit the frame: title, options, and hint cost
  // ~10 rows besides the border, so the diff gets whatever is left — never
  // the full MAX_DIFF_ROWS on a short terminal (that overflow squashed the
  // whole app before the flex fix).
  const maxRows = Math.max(3, Math.min(MAX_DIFF_ROWS, termRows - 12));
  const parsed = React.useMemo(() => parseDiff(diff), [diff]);
  const words = React.useMemo(() => pairRows(parsed, (r) => r.text), [parsed]);
  const visible = parsed.slice(0, maxRows);
  const omitted = parsed.length - visible.length;
  const addColor = theme.colors.toolDone;
  const delColor = theme.colors.toolError;
  const hunkColor = theme.colors.accent;

  return (
    <Box flexDirection="column">
      {visible.map((row, i) => {
        const key = `${i}`;
        if (row.kind === "file") {
          return (
            <Text key={key} dimColor bold>
              {curtail(row.text, maxText)}
            </Text>
          );
        }
        if (row.kind === "hunk") {
          return (
            <Text key={key} color={hunkColor}>
              {row.text}
            </Text>
          );
        }
        if (row.kind === "meta") {
          return (
            <Text key={key} dimColor>
              {curtail(row.text, maxText)}
            </Text>
          );
        }
        if (row.kind === "context") {
          return (
            <Text key={key} dimColor>
              {gutter(row)}
              {curtail(row.text, maxText)}
            </Text>
          );
        }
        const sign = row.kind === "add" ? "+" : "-";
        const base = row.kind === "add" ? addColor : delColor;
        const segs = words.get(i);
        // Word highlights are dropped for overlong lines: a curtailed line
        // can't keep segment alignment, and overflow is the worse failure.
        const plain = segs ? segs.map((s) => s.text).join("") : row.text;
        const useWords = segs !== undefined && Array.from(plain).length <= maxText;
        return (
          <Text key={key}>
            <Text color={base} bold>
              {sign}
            </Text>
            <Text dimColor>{gutter(row)}</Text>
            {useWords ? (
              <WordText segs={segs} base={base} />
            ) : (
              <Text color={base}>{curtail(row.text, maxText)}</Text>
            )}
          </Text>
        );
      })}
      {omitted > 0 && <Text dimColor>… {omitted} more diff line(s) omitted</Text>}
    </Box>
  );
}
