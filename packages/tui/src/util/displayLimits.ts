/** Shared display budgets (single source — was scattered literals). */
import { tailChars } from "./format.js";

export const TOOL_SUMMARY_MAX = 60; // one-line tool/sub-agent summaries
export const SUBAGENT_TASK_MAX = 60;
export const SESSION_TITLE_MAX = 40; // session picker titles
export const EXPANDED_MAX_LINES = 30; // expanded tool output / sub-agent reports
export const MAX_VISIBLE_ROWS = 8; // picker window size
export const HELP_VISIBLE_ROWS = 20; // help overlay content rows (taller: reference doc, not a picker)
export const LEDGER_MAX_ROWS = 15; // /ledger recent rows
export const TRANSCRIPT_STATE_CAP = 1000; // DisplayMessage[] bound
export const TRANSCRIPT_SCROLL_PAGE = 5; // PgUp/PgDn transcript messages per press
export const TEXT_FLUSH_INTERVAL_MS = 16; // ~60 FPS streaming-text throttle window
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
/** Retained plan-text cap: a multi-KB plan must not flood the transcript. */
export const PLAN_RETAIN_MAX = 4000;
/** Max diff rows rendered in the permission overlay before an omission note. */
export const MAX_DIFF_ROWS = 40;
// D1 (§2.4): display caps hoisted from their consumers — values preserved.
export const GUARDIAN_VIOLATIONS_SHOWN = 8;
export const GUARDIAN_DETAIL_MAX = 80;
export const TOOL_DIAGNOSTICS_SHOWN = 3;
export const HELP_FILTER_MAX = 40;
export const STATUS_MODEL_MAX = 40;
export const STATUS_MODEL_MIN = 24;
export const HEADER_TITLE_MAX = 24;
export const HEADER_NAME_MAX = 18;
export const HEADER_BRANCH_MAX = 16;
export const HEADER_ECO_MAX = 16;
export const HEADER_TEST_MAX = 18;
export const HEADER_RULES_MAX = 16;
export const VERIFY_SUMMARY_MAX = 120;
export const MISSION_DETAIL_MAX = 30;
export const DIFF_PATH_MAX = 24;
export const SYNC_FREE_SHOWN = 6;
export const DIFF_CHANGES_SHOWN = 8;
export const SESSION_MRU_CAP = 5;
export const NOTIFY_CLEAN_MAX = 200;
export const SESSION_ID_SHORT_MAX = 8;

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

// Phase 38.6: streamed model reasoning. `reasoning_delta` text is retained
// bounded in React state and rendered only under /expand, capped, so a 2,000-
// character deliberation cannot flood the default transcript.
export const REASONING_RETAIN_MAX = 6000;
export const REASONING_DISPLAY_MAX_CHARS = 600;

// H1 (AUDIT-2026-09-30): blinking cursor cadence while a turn streams
// (util/useSpinner.ts). A display budget, so it lives with the other caps.
export const SPINNER_BLINK_INTERVAL_MS = 530;

/**
 * Cap text with an omission notice, keeping the END. Callers retain from the
 * tail (REASONING_RETAIN_MAX keeps the newest reasoning), so a head-cap would
 * render a middle slice of a long deliberation — neither its start nor its
 * end. The leading notice preserves the most recent text. The tail itself comes
 * from `tailChars` (code-point aware), because a blind `slice(-max)` can begin
 * on the low half of a surrogate pair. Pure.
 */
export function capChars(text: string, max: number): string {
  const tail = tailChars(text, max);
  if (tail === text) return text;
  // The notice counts what was ACTUALLY dropped — snapping the tail off a
  // surrogate pair drops one more unit than the nominal cap, and a notice that
  // printed `max` there would be a lie.
  return `… (${text.length - tail.length} earlier char(s) omitted) ${tail}`;
}
