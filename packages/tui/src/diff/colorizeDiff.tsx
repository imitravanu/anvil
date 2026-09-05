import React from "react";
import { Box, Text } from "ink";
import { parseDiff, type DiffRow } from "./parseDiff.js";
import { pairRows, type WordSeg } from "./wordDiff.js";

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
 * U5 richer diffs: line numbers, paired del/add word highlighting, capped
 * rows. Same props as before — PermissionPrompt needs no changes.
 */
export function ColorizedDiff({ diff }: { diff: string }) {
  const rows = React.useMemo(() => parseDiff(diff), [diff]);
  const words = React.useMemo(() => pairRows(rows, (r) => r.text), [rows]);
  const visible = rows.slice(0, MAX_DIFF_ROWS);
  const omitted = rows.length - visible.length;

  return (
    <Box flexDirection="column">
      {visible.map((row, i) => {
        const key = `${i}`;
        if (row.kind === "file") {
          return (
            <Text key={key} dimColor bold>
              {row.text}
            </Text>
          );
        }
        if (row.kind === "hunk") {
          return (
            <Text key={key} color="cyan">
              {row.text}
            </Text>
          );
        }
        if (row.kind === "meta") {
          return (
            <Text key={key} dimColor>
              {row.text}
            </Text>
          );
        }
        if (row.kind === "context") {
          return (
            <Text key={key} dimColor>
              {gutter(row)}
              {row.text}
            </Text>
          );
        }
        const sign = row.kind === "add" ? "+" : "-";
        const base = row.kind === "add" ? "green" : "red";
        const segs = words.get(i);
        return (
          <Text key={key}>
            <Text color={base} bold>
              {sign}
            </Text>
            <Text dimColor>{gutter(row)}</Text>
            {segs ? (
              <WordText segs={segs} base={base} />
            ) : (
              <Text color={base}>{row.text}</Text>
            )}
          </Text>
        );
      })}
      {omitted > 0 && <Text dimColor>… {omitted} more diff line(s) omitted</Text>}
    </Box>
  );
}
