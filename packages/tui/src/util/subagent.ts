/** U10 sub-agent cards: collapsed line + capped report lines. Pure. */

export interface SubAgentRecord {
  task: string;
  status: "running" | "done" | "cancelled";
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  report: string;
}

/** Heap guard: full reports stay in history for the model; the card keeps this much. */
export const SUB_REPORT_RETAIN_MAX = 4000;
const TRUNC_MARK = "[report shortened for display — full version went to the model]";

export function retainReport(report: string): string {
  if (report.length <= SUB_REPORT_RETAIN_MAX) return report;
  return report.slice(0, SUB_REPORT_RETAIN_MAX) + "\n" + TRUNC_MARK;
}

/** One-line collapsed summary: `◈ sub-agent: <task> — N calls, X in/Y out`. */
export function formatSubAgentLine(sub: Pick<SubAgentRecord, "task" | "status" | "toolCalls" | "inputTokens" | "outputTokens">): string {
  const first = (sub.task.split("\n")[0] ?? "").trim();
  const task = first.length > 60 ? first.slice(0, 59) + "…" : first || "(no task)";
  const counts =
    sub.status === "running"
      ? "running…"
      : sub.status === "cancelled"
        ? "cancelled"
        : `${sub.toolCalls} call${sub.toolCalls === 1 ? "" : "s"}, ` +
          `${sub.inputTokens.toLocaleString()} in/${sub.outputTokens.toLocaleString()} out`;
  return `◈ sub-agent: ${task} — ${counts}`;
}

/** Report body for expanded display, capped with an omission notice. */
export const MAX_REPORT_LINES = 30;

export function capReportLines(report: string, max: number = MAX_REPORT_LINES): string[] {
  if (!report) return ["(empty report)"];
  const lines = report.split("\n");
  if (lines.length <= max) return lines;
  return [...lines.slice(0, max), `… ${lines.length - max} more line(s) omitted`];
}
