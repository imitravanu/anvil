/** Shared display budgets (single source — was scattered literals). */
export const TOOL_SUMMARY_MAX = 60; // one-line tool/sub-agent summaries
export const SUBAGENT_TASK_MAX = 60;
export const SESSION_TITLE_MAX = 40; // session picker titles
export const EXPANDED_MAX_LINES = 30; // expanded tool output / sub-agent reports
export const MAX_VISIBLE_ROWS = 8; // picker window size
export const LEDGER_MAX_ROWS = 15; // /ledger recent rows
export const TRANSCRIPT_STATE_CAP = 1000; // DisplayMessage[] bound
export const HISTORY_RECALL_CAP = 100; // sentHistory bound
export const MESSAGE_QUEUE_CAP = 10; // messages typed while a turn runs
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024; // /image attachment cap

/** "… N more line(s) omitted" suffix shared by expanded viewers. */
export function omittedLine(total: number, shown: number): string {
  return `… ${total - shown} more line(s) omitted`;
}

/** Cap lines with an omission notice. Pure. */
export function capLines(lines: string[], max: number = EXPANDED_MAX_LINES): string[] {
  if (lines.length <= max) return lines;
  return [...lines.slice(0, max), omittedLine(lines.length, max)];
}
