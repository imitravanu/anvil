import { randomUUID } from "node:crypto";
import type React from "react";
import type { AgentEvent } from "@anvil/core";
import { retainReport, type SubAgentRecord } from "../util/subagent.js";
import { friendlyError } from "../util/errors.js";
import { TRANSCRIPT_STATE_CAP } from "../util/displayLimits.js";

export type DisplaySubAgent = SubAgentRecord;

export interface DisplayToolCall {
  id: string;
  name: string;
  input: unknown;
  status: "running" | "done" | "error" | "cancelled";
  summary?: string;
  /** Full tool result output, retained capped (see OUTPUT_RETAIN_MAX) for /expand. */
  output?: unknown;
}

/** Cap retained output so long sessions can't bloat React state. */
export const OUTPUT_RETAIN_MAX = 6000;

/** Per-string cap inside retained output (the total cap alone still spikes). */
const RETAIN_STRING_MAX = 2000;

export function retainOutput(output: unknown): unknown {
  if (output === undefined) return undefined;
  let text: string;
  try {
    text =
      JSON.stringify(output, (_key, value) =>
        typeof value === "string" && value.length > RETAIN_STRING_MAX
          ? value.slice(0, RETAIN_STRING_MAX) + "…[truncated]"
          : value
      ) ?? String(output);
  } catch {
    return { note: "[output not serializable for display]" };
  }
  if (text.length <= OUTPUT_RETAIN_MAX) {
    try {
      return JSON.parse(text);
    } catch {
      return { truncated: text, note: "[output truncated for display]" };
    }
  }
  return { truncated: text.slice(0, OUTPUT_RETAIN_MAX), note: "[output truncated for display]" };
}

export interface DisplayVerification {
  id: string;
  command: string;
  status: "running" | "passed" | "failed";
  summary?: string;
  repairsUsed: number;
}

export interface DisplayGoalMilestone {
  id: string;
  title: string;
  criteria: string;
  status: "pending" | "in_progress" | "completed" | "failed";
  summary?: string;
  detail?: string;
}

export interface DisplayGoal {
  title: string;
  milestones: DisplayGoalMilestone[];
  currentTurn: number;
  maxTurns: number;
}

/** Phase 26.1 — structured guardian turn report. */
export interface DisplayGuardianReport {
  /** Pending mutations refused this turn. */
  blocked: number;
  /** Changes the guardian repaired in place before execution. */
  fixed: number;
  violations: {
    file: string;
    line: number;
    rule: string;
    family: string;
    detail: string;
  }[];
}

export interface DisplayMessage {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  streaming: boolean;
  toolCalls: DisplayToolCall[];
  subAgents: DisplaySubAgent[];
  verifications?: DisplayVerification[];
  /** Guardian turn reports (blocked/auto-fixed) attached to this turn. */
  guardianReports?: DisplayGuardianReport[];
  images?: { path: string }[];
  errorText?: string;
  /** Creation time (epoch ms); absent for resumed history — no time renders. */
  ts?: number;
}

export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
}

export function systemMessage(text: string): DisplayMessage {
  return { id: randomUUID(), role: "system", text, streaming: false, toolCalls: [], subAgents: [], ts: Date.now() };
}

export function appendSystemMessage(
  setMessages: React.Dispatch<React.SetStateAction<DisplayMessage[]>>,
  text: string
): void {
  setMessages((prev) => {
    const next = [...prev, systemMessage(text)];
    return next.length > TRANSCRIPT_STATE_CAP ? next.slice(-TRANSCRIPT_STATE_CAP) : next;
  });
}

export function applyEvent(
  event: AgentEvent,
  update: (fn: (m: DisplayMessage) => DisplayMessage) => void,
  setUsage: React.Dispatch<React.SetStateAction<UsageTotals>>,
  setMessages: React.Dispatch<React.SetStateAction<DisplayMessage[]>>,
  setPlan: React.Dispatch<React.SetStateAction<string | null>>,
  setTestStatus?: React.Dispatch<React.SetStateAction<"green" | "failed" | "running" | null>>
): void {
  switch (event.type) {
    case "text_delta":
      update((m) => ({ ...m, text: m.text + event.text }));
      break;
    case "tool_started":
      update((m) => ({
        ...m,
        toolCalls: [
          ...m.toolCalls,
          { id: event.id, name: event.name, input: event.input, status: "running" },
        ],
      }));
      break;
    case "tool_finished":
      update((m) => ({
        ...m,
        toolCalls: m.toolCalls.map((t) =>
          t.id === event.id
            ? {
                ...t,
                status: (event.result.isError ? "error" : "done") as DisplayToolCall["status"],
                summary: event.result.summary,
                output: retainOutput(event.result.output),
              }
            : t
        ),
      }));
      break;
    case "tool_permission_denied":
      update((m) => ({
        ...m,
        toolCalls: m.toolCalls.map((t) =>
          t.id === event.id ? { ...t, status: "error", summary: "Denied" } : t
        ),
      }));
      break;
    case "usage":
      setUsage((prev) => ({
        inputTokens: prev.inputTokens + event.inputTokens,
        outputTokens: prev.outputTokens + event.outputTokens,
      }));
      break;
    case "error":
      setMessages((prev) =>
        prev.map((m) =>
          m.role === "system" && m.text.startsWith("Rate limited — waiting")
            ? { ...m, text: "Rate limited — the automatic retry also hit the limit (error above)." }
            : m
        )
      );
      update((m) => ({
        ...m,
        errorText: friendlyError(event.message),
        toolCalls: m.toolCalls.map((t) =>
          t.status === "running" ? { ...t, status: "error" as const, summary: "Turn failed" } : t
        ),
      }));
      break;
    case "compacted":
      appendSystemMessage(
        setMessages,
        `Conversation compacted to stay within context limits.\n\n${event.summary}`
      );
      break;
    case "rate_limit_wait":
      appendSystemMessage(
        setMessages,
        `Rate limited — waiting ${event.seconds}s, retrying automatically…`
      );
      break;
    case "budget_exhausted":
      appendSystemMessage(
        setMessages,
        'Turn stopped after reaching its step limit. Type "continue" to keep going, or revise the task.'
      );
      break;
        case "loop_detected":
      appendSystemMessage(
        setMessages,
        `Loop guard: ${event.tool} was repeated 3× without progress. Further identical calls are blocked.`
      );
      break;
    case "guardian_blocked":
      update((m) => ({
        ...m,
        guardianReports: [
          ...(m.guardianReports ?? []),
          {
            blocked: event.count,
            fixed: event.fixed,
            violations: event.violations.map((v) => ({
              file: v.file,
              line: v.line,
              rule: v.rule,
              family: v.family,
              detail: v.detail,
            })),
          },
        ],
      }));
      break;
    case "plan_updated":
      setPlan(event.plan || null);
      appendSystemMessage(setMessages, `Plan updated: ${event.plan}`);
      break;
    case "verification_started":
      setTestStatus?.("running");
      update((m) => {
        const list = m.verifications ?? [];
        if (list.length > 0 && list[list.length - 1].status === "failed") {
          const last = list[list.length - 1];
          const updated = [
            ...list.slice(0, -1),
            { ...last, status: "running" as const, repairsUsed: last.repairsUsed + 1 },
          ];
          return { ...m, verifications: updated };
        }
        return {
          ...m,
          verifications: [
            ...list,
            {
              id: randomUUID(),
              command: event.command,
              status: "running",
              repairsUsed: 0,
            },
          ],
        };
      });
      break;
    case "verification_result":
      setTestStatus?.(event.passed ? "green" : "failed");
      update((m) => {
        const list = m.verifications ?? [];
        if (list.length === 0) return m;
        const lastIdx = list.length - 1;
        const updated = list.map((v, i) =>
          i === lastIdx
            ? {
                ...v,
                status: (event.passed ? "passed" : "failed") as DisplayVerification["status"],
                summary: event.summary,
              }
            : v
        );
        return { ...m, verifications: updated };
      });
      break;
    case "verification_gave_up":
      setTestStatus?.("failed");
      appendSystemMessage(
        setMessages,
        `⚠ Auto-verification gave up after its repair budget — tests may still be failing (${event.command}).`
      );
      update((m) => {
        const list = m.verifications ?? [];
        if (list.length === 0) return m;
        const lastIdx = list.length - 1;
        const verifications = list.map((v, i) =>
          i === lastIdx
            ? {
                ...v,
                status: "failed" as const,
                summary: v.summary ?? "Repair attempts exhausted — tests may still be failing.",
              }
            : v
        );
        return { ...m, verifications };
      });
      break;
    case "checkpoint":
      appendSystemMessage(
        setMessages,
        `Checkpoint #${event.id}: ${event.files} file${event.files === 1 ? "" : "s"} snapshotted — /rewind ${event.id} to undo.`
      );
      break;
    case "subagent_started":
      update((m) => ({
        ...m,
        subAgents: [
          ...m.subAgents,
          { task: event.task, status: "running", toolCalls: 0, inputTokens: 0, outputTokens: 0, report: "" },
        ],
      }));
      break;
    case "subagent_progress":
      update((m) => {
        const idx = m.subAgents.findIndex((s) => s.status === "running");
        if (idx === -1) return m;
        const subAgents = m.subAgents.map((s, i) =>
          i === idx ? { ...s, toolCalls: s.toolCalls + 1, lastTool: event.tool } : s
        );
        return { ...m, subAgents };
      });
      break;
    case "subagent_finished": {
      setUsage((prev) => ({
        inputTokens: prev.inputTokens + event.inputTokens,
        outputTokens: prev.outputTokens + event.outputTokens,
      }));
      const done: DisplaySubAgent = {
        task: "",
        status: "done",
        toolCalls: event.toolCalls,
        inputTokens: event.inputTokens,
        outputTokens: event.outputTokens,
        report: retainReport(event.report),
        lastTool: undefined,
      };
      update((m) => {
        const idx = m.subAgents.findIndex((s) => s.status === "running");
        if (idx === -1) return { ...m, subAgents: [...m.subAgents, done] };
        const subAgents = m.subAgents.map((s, i) =>
          i === idx ? { ...s, ...done, task: s.task } : s
        );
        return { ...m, subAgents };
      });
      break;
    }
    case "cancelled":
      update((m) => ({
        ...m,
        toolCalls: m.toolCalls.map((t) =>
          t.status === "running" ? { ...t, status: "cancelled" as const, summary: "Cancelled" } : t
        ),
        subAgents: m.subAgents.map((s) => (s.status === "running" ? { ...s, status: "cancelled" } : s)),
      }));
      break;
  }
}
