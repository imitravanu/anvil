/** U10 sub-agent cards: collapsed line + capped report lines. Pure. */
import { SUBAGENT_TASK_MAX, capLines } from "./displayLimits.js";
export { EXPANDED_MAX_LINES as MAX_REPORT_LINES } from "./displayLimits.js";

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
  const task =
    first.length > SUBAGENT_TASK_MAX ? first.slice(0, SUBAGENT_TASK_MAX - 1) + "…" : first || "(no task)";
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
export function capReportLines(report: string, max?: number): string[] {
  if (!report) return ["(empty report)"];
  return capLines(report.split("\n"), max);
}
