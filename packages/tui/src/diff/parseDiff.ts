/**
 * U5 richer diffs: parse a unified diff string into structured rows.
 * Pure, no React — ColorizedDiff just renders the rows.
 */

export type DiffRow =
  | { kind: "file"; text: string } // --- / +++ file headers
  | { kind: "hunk"; text: string; oldStart: number; newStart: number }
  | { kind: "add"; text: string; oldNo: null; newNo: number }
  | { kind: "del"; text: string; oldNo: number; newNo: null }
  | { kind: "context"; text: string; oldNo: number; newNo: number }
  | { kind: "meta"; text: string }; // "\ No newline" markers, index lines, …

const HUNK_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/;

export function parseDiff(diff: string): DiffRow[] {
  const rows: DiffRow[] = [];
  let oldNo = 0;
  let newNo = 0;
  let inHunk = false;
  const lines = diff.split("\n");
  // The string's own trailing newline is an artifact, not a context line.
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  for (const line of lines) {
    if (line.startsWith("--- ") || line.startsWith("+++ ")) {
      rows.push({ kind: "file", text: line });
      continue;
    }
    const hunk = line.match(HUNK_RE);
    if (hunk) {
      oldNo = Number(hunk[1]);
      newNo = Number(hunk[2]);
      inHunk = true;
      rows.push({ kind: "hunk", text: line, oldStart: oldNo, newStart: newNo });
      continue;
    }
    if (!inHunk) {
      rows.push({ kind: "meta", text: line });
      continue;
    }
    if (line.startsWith("+") && !line.startsWith("+++")) {
      rows.push({ kind: "add", text: line.slice(1), oldNo: null, newNo: newNo });
      newNo += 1;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      rows.push({ kind: "del", text: line.slice(1), oldNo, newNo: null });
      oldNo += 1;
    } else if (line.startsWith("\\")) {
      rows.push({ kind: "meta", text: line });
    } else if (line.startsWith(" ")) {
      rows.push({ kind: "context", text: line.slice(1), oldNo, newNo });
      oldNo += 1;
      newNo += 1;
    } else if (line === "") {
      // Genuinely empty file line inside a hunk (GNU diff emits it bare).
      rows.push({ kind: "context", text: "", oldNo, newNo });
      oldNo += 1;
      newNo += 1;
    } else {
      rows.push({ kind: "meta", text: line });
    }
  }
  return rows;
}
