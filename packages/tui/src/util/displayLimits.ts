/** Shared display budgets (single source — was scattered literals). */
export const TOOL_SUMMARY_MAX = 60; // one-line tool/sub-agent summaries
export const SUBAGENT_TASK_MAX = 60;
export const SESSION_TITLE_MAX = 40; // session picker titles
export const EXPANDED_MAX_LINES = 30; // expanded tool output / sub-agent reports
export const MAX_VISIBLE_ROWS = 8; // picker window size
export const LEDGER_MAX_ROWS = 15; // /ledger recent rows
export const TRANSCRIPT_STATE_CAP = 1000; // DisplayMessage[] bound
export const TRANSCRIPT_SCROLL_PAGE = 5; // PgUp/PgDn transcript messages per press
export const HISTORY_RECALL_CAP = 100; // sentHistory bound
export const MESSAGE_QUEUE_CAP = 10; // messages typed while a turn runs
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024; // /image attachment cap

// AUDIT-11: caps that lived beside their consumers (§2.4) — centralized here
// with the rest of the display budgets; the defining modules re-export them so
// their public API is unchanged.
/** Heap guard: full sub-agent reports go to the model; the card keeps this much. */
export const SUB_REPORT_RETAIN_MAX = 4000;
/** Retained tool-output cap so long sessions can't bloat React state. */
export const OUTPUT_RETAIN_MAX = 6000;
/** Max diff rows rendered in the permission overlay before an omission note. */
export const MAX_DIFF_ROWS = 40;

// Code-block windowing: a 40-line block otherwise fills the whole transcript
// and (via the flex clip) shows only its tail, silently. Render head+tail
// with an omission marker instead; the full block lives in the session file.
export const CODE_HEAD_LINES = 10;
export const CODE_TAIL_LINES = 3;

// 28.11: code blocks from this many lines get a line-number gutter. One-liners
// and pairs stay clean — a gutter on a snippet costs more than it orients.
export const CODE_NUMBER_MIN_LINES = 3;

/**
 * Whether a markdown block gets a blank line above it. Paragraph-like blocks
 * (text, hr) stay tight under their neighbors; structural blocks breathe.
 * Shared by MarkdownView (renders it) and the transcript estimator (counts
 * it) so the "… N earlier messages" indicator stays honest.
 */
export function markdownBlockSpaced(kind: string, prevKind: string | undefined): boolean {
  if (!prevKind) return false;
  if (kind === "heading" || kind === "code" || kind === "table" || kind === "links" || kind === "quote") return true;
  if (kind === "list") return prevKind !== "list";
  // text/hr: only breathe after a boxed block, not after lists or other text.
  return prevKind === "code" || prevKind === "table" || prevKind === "links" || prevKind === "quote";
}

/** "… N more line(s) omitted" suffix shared by expanded viewers. */
export function omittedLine(total: number, shown: number): string {
  return `… ${total - shown} more line(s) omitted`;
}

/** Cap lines with an omission notice. Pure. */
export function capLines(lines: string[], max: number = EXPANDED_MAX_LINES): string[] {
  if (lines.length <= max) return lines;
  return [...lines.slice(0, max), omittedLine(lines.length, max)];
}
