import { randomUUID } from "node:crypto";
import type React from "react";
import type { AgentEvent } from "@anvil/core";
import { retainReport, type SubAgentRecord } from "../util/subagent.js";
import { friendlyError } from "../util/errors.js";
import { headChars, tailChars } from "../util/format.js";
import { TRANSCRIPT_STATE_CAP, OUTPUT_RETAIN_MAX, REASONING_RETAIN_MAX } from "../util/displayLimits.js";

export type DisplaySubAgent = SubAgentRecord;

export interface DisplayToolCall {
  id: string;
  name: string;
  input: unknown;
  status: "running" | "done" | "error" | "cancelled";
  summary?: string;
  /** Full tool result output, retained capped (see OUTPUT_RETAIN_MAX) for /expand. */
  output?: unknown;
  /** Execution time reported by core's `tool_finished`; absent when nothing ran. */
  durationMs?: number;
}

/** Cap retained output so long sessions can't bloat React state. */
export { OUTPUT_RETAIN_MAX };

/** Per-string cap inside retained output (the total cap alone still spikes). */
const RETAIN_STRING_MAX = 2000;

/**
 * F3 (AUDIT-2026-09-30): the newest card carrying this member id. Correlating
 * by `status === "running"` stamped the wrong row whenever two team members
 * were in flight; the id is the identity core now stamps on every event.
 * Sequential delegations reuse `delegate`, so the LAST match is the live one.
 */
function lastIndexOfMember(subAgents: readonly DisplaySubAgent[], id: string): number {
  for (let i = subAgents.length - 1; i >= 0; i--) {
    if (subAgents[i].id === id) return i;
  }
  return -1;
}

/**
 * F4 (AUDIT-2026-09-30): accumulate a usage delta while PRESERVING any optional
 * breakdown the event omits. Rebuilding `{ inputTokens, outputTokens }` fresh
 * dropped the reasoning/cached totals the status bar renders.
 */
function accumulateUsage(
  prev: UsageTotals,
  event: { inputTokens: number; outputTokens: number; reasoningTokens?: number; cachedInputTokens?: number }
): UsageTotals {
  const next: UsageTotals = {
    inputTokens: prev.inputTokens + event.inputTokens,
    outputTokens: prev.outputTokens + event.outputTokens,
  };
  const reasoning =
    event.reasoningTokens === undefined
      ? prev.reasoningTokens
      : (prev.reasoningTokens ?? 0) + event.reasoningTokens;
  if (reasoning !== undefined) next.reasoningTokens = reasoning;
  const cached =
    event.cachedInputTokens === undefined
      ? prev.cachedInputTokens
      : (prev.cachedInputTokens ?? 0) + event.cachedInputTokens;
  if (cached !== undefined) next.cachedInputTokens = cached;
  return next;
}

/** Head-cap one retained string without splitting a surrogate pair. */
function retainString(value: string): string {
  const head = headChars(value, RETAIN_STRING_MAX);
  return head === value ? value : head + "…[truncated]";
}

export function retainOutput(output: unknown): unknown {
  if (output === undefined) return undefined;
  let text: string;
  try {
    text =
      JSON.stringify(output, (_key, value) =>
        typeof value === "string" ? retainString(value) : value
      ) ?? String(output);
  } catch {
    // intentional: a circular/unserializable tool payload falls back to a
    // display note; the data exists only for rendering.
    return { note: "[output not serializable for display]" };
  }
  if (text.length <= OUTPUT_RETAIN_MAX) {
    try {
      return JSON.parse(text);
    } catch {
      // intentional: re-parsing can fail on a string cut mid-escape by the
      // retain cap; the truncated text is the intended fallback.
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
  /**
   * Per-turn token totals (Phase 28.10), accumulated from this turn's
   * `usage` events. Absent on resumed history (no events replay) — the
   * cost line renders only when the data is genuinely known.
   */
  inputTokens?: number;
  outputTokens?: number;
  /**
   * Phase 38.6 — the model's streamed deliberation, accumulated from
   * `reasoning_delta` events. Kept apart from `text` because reasoning is not
   * the answer: it is never replayed into history and renders only under
   * /expand. Absent when the provider streamed none.
   */
  reasoning?: string;
}

export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  /**
   * Reasoning tokens included in `outputTokens` (Phase 38.2). Kept apart so the
   * status bar can show that a turn spent most of its output thinking rather
   * than answering. Accumulates only when the provider reports it — 0 means
   * "none reported", never "zero tokens".
   */
  reasoningTokens?: number;
  /**
   * Input tokens served from the provider's prompt cache, counted INSIDE
   * `inputTokens`. The difference (input - cached) is what was actually billed
   * as fresh.
   */
  cachedInputTokens?: number;
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
    case "reasoning_delta":
      // Bounded like tool output: long sessions must not bloat React state.
      // tailChars, not slice(-max): the bound can land inside a surrogate pair,
      // and an emoji cut in half renders as a replacement glyph (38.x finding).
      update((m) => ({
        ...m,
        reasoning: tailChars((m.reasoning ?? "") + event.text, REASONING_RETAIN_MAX),
      }));
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
                durationMs: event.durationMs,
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
      // Optional breakdowns accumulate only when present, so a provider that
      // omits them never has its zero written over a real running total.
      setUsage((prev) => accumulateUsage(prev, event));
      // 28.10: the same event carries THIS response's tokens, so accumulating
      // onto the turn's message yields the per-turn total for /expand — a
      // multi-step turn (text → tools → text) reports each provider response
      // and they sum naturally. Resumed history replays no events, so those
      // messages stay unannotated rather than showing a fabricated zero.
      update((m) => ({
        ...m,
        inputTokens: (m.inputTokens ?? 0) + event.inputTokens,
        outputTokens: (m.outputTokens ?? 0) + event.outputTokens,
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
          {
            id: event.id,
            task: event.task,
            status: "running",
            toolCalls: 0,
            inputTokens: 0,
            outputTokens: 0,
            report: "",
          },
        ],
      }));
      break;
    case "subagent_progress":
      update((m) => {
        const idx = lastIndexOfMember(m.subAgents, event.id);
        // A progress line for a card that is not running (already finished, or
        // never started) has nothing to update — never fall back to "some other
        // running member", which is exactly the misattribution F3 fixed.
        if (idx === -1 || m.subAgents[idx].status !== "running") return m;
        const subAgents = m.subAgents.map((s, i) =>
          i === idx ? { ...s, toolCalls: s.toolCalls + 1, lastTool: event.tool } : s
        );
        return { ...m, subAgents };
      });
      break;
    case "subagent_finished": {
      setUsage((prev) => accumulateUsage(prev, event));
      const done: DisplaySubAgent = {
        id: event.id,
        task: "",
        status: "done",
        toolCalls: event.toolCalls,
        inputTokens: event.inputTokens,
        outputTokens: event.outputTokens,
        report: retainReport(event.report),
        lastTool: undefined,
      };
      update((m) => {
        const idx = lastIndexOfMember(m.subAgents, event.id);
        // No card for this member (its start was never rendered) — append a
        // finished one so the report is never silently dropped.
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
