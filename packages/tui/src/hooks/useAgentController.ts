import { useCallback, useEffect, useRef, useState } from "react";
import { randomUUID } from "node:crypto";
import { AgentSession, type AgentEvent } from "@anvil/core";
import { retainReport, type SubAgentRecord } from "../util/subagent.js";
import { friendlyError } from "../util/errors.js";
import { HISTORY_RECALL_CAP, TRANSCRIPT_STATE_CAP } from "../util/displayLimits.js";

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
  let text: string;
  try {
    // Cap long strings DURING serialization: stringifying a multi-megabyte
    // tool result in full just to slice it would spike memory first.
    text =
      JSON.stringify(output, (_key, value) =>
        typeof value === "string" && value.length > RETAIN_STRING_MAX
          ? value.slice(0, RETAIN_STRING_MAX) + "…[truncated]"
          : value
      ) ?? String(output);
  } catch {
    return { note: "[output not serializable for display]" };
  }
  // Return the capped parse (never the original reference): retained display
  // state stays bounded no matter how large the tool result was.
  if (text.length <= OUTPUT_RETAIN_MAX) {
    try {
      return JSON.parse(text);
    } catch {
      return { truncated: text, note: "[output truncated for display]" };
    }
  }
  return { truncated: text.slice(0, OUTPUT_RETAIN_MAX), note: "[output truncated for display]" };
}

export interface DisplayMessage {
  id: string;
  role: "user" | "assistant" | "system";
  text: string; // accumulated so far; may still be mid-stream
  streaming: boolean;
  toolCalls: DisplayToolCall[];
  subAgents: DisplaySubAgent[]; // delegation cards live on the assistant turn
  /** Friendly, compact turn-failure line (raw provider walls are remapped). */
  errorText?: string;
}

export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
}

/**
 * Bridges AgentSession's async generator into React state. Every event handler
 * does a full setMessages map (never in-place mutation) so React re-renders.
 */
export function useAgentController(session: AgentSession) {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const [usage, setUsage] = useState<UsageTotals>({ inputTokens: 0, outputTokens: 0 });
  const currentAssistantId = useRef<string | null>(null);
  const [sentHistory, setSentHistory] = useState<string[]>([]);
  // the persistent plan — seeded from the session, updated live
  // by plan_updated events, reset whenever the active session changes.
  const [plan, setPlan] = useState<string | null>(session.plan ?? null);
  useEffect(() => {
    setPlan(session.plan ?? null);
    // Usage totals belong to the session too — a fresh/cleared transcript
    // must not show the previous session's spend in the StatusBar.
    setUsage({ inputTokens: 0, outputTokens: 0 });
  }, [session]);

  const send = useCallback(
    async (text: string) => {
      if (isBusy) return; // simplest policy for this phase: ignore input while busy
      // Bounded state: recall needs dozens, not thousands; the transcript window
      // renders a handful while history truth lives in the session file.
      setSentHistory((prev) => [...prev, text].slice(-HISTORY_RECALL_CAP));
      const userMsg: DisplayMessage = {
        id: randomUUID(),
        role: "user",
        text,
        streaming: false,
        toolCalls: [],
        subAgents: [],
      };
      const assistantId = randomUUID();
      currentAssistantId.current = assistantId;
      setMessages((prev) => {
        const next: DisplayMessage[] = [
          ...prev,
          userMsg,
          { id: assistantId, role: "assistant", text: "", streaming: true, toolCalls: [], subAgents: [] },
        ];
        return next.length > TRANSCRIPT_STATE_CAP ? next.slice(-TRANSCRIPT_STATE_CAP) : next;
      });
      setIsBusy(true);

      const updateAssistant = (fn: (m: DisplayMessage) => DisplayMessage) => {
        setMessages((prev) => prev.map((m) => (m.id === assistantId ? fn(m) : m)));
      };

      // One display message carries the whole turn, but the turn can be
      // several loop iterations (text → tools → text). Without a separator
      // each iteration's prose concatenates directly onto the previous
      // ("Let me look around first.All checks pass…"); a blank line between
      // them reads as the paragraphs the model actually produced.
      let textNeedsBreak = false;
      try {
        for await (const event of session.send(text)) {
          if (event.type === "text_delta" && textNeedsBreak) {
            updateAssistant((m) => ({ ...m, text: m.text + "\n\n" }));
            textNeedsBreak = false;
          }
          if (event.type === "tool_finished" || event.type === "tool_permission_denied") {
            textNeedsBreak = true;
          }
          applyEvent(event, updateAssistant, setUsage, setMessages, setPlan);
        }
      } finally {
        // Mark streaming done either way — completion, cancellation, or error.
        updateAssistant((m) => ({ ...m, streaming: false }));
        setIsBusy(false);
        currentAssistantId.current = null;
      }
    },
    [session, isBusy]
  );

  const cancel = useCallback(() => session.cancel(), [session]);

  /** Append a system notice to the transcript — never sent to the model. */
  const printSystemMessage = useCallback((text: string) => {
    setMessages((prev) => [
      ...prev,
      { id: randomUUID(), role: "system" as const, text, streaming: false, toolCalls: [], subAgents: [] },
    ]);
  }, []);

  /** Clear the visible transcript (pairs with session.clearHistory() for /clear). */
  const clearMessages = useCallback(() => {
    setMessages([]);
  }, []);

  /** Seed the transcript (e.g. when resuming a stored session). */
  const replaceMessages = useCallback((seed: DisplayMessage[]) => {
    setMessages(seed);
  }, []);

  return {
    messages,
    isBusy,
    usage,
    plan,
    send,
    cancel,
    printSystemMessage,
    clearMessages,
    replaceMessages,
    sentHistory,
  };
}

function systemMessage(text: string): DisplayMessage {
  return { id: randomUUID(), role: "system", text, streaming: false, toolCalls: [], subAgents: [] };
}

function applyEvent(
  event: AgentEvent,
  update: (fn: (m: DisplayMessage) => DisplayMessage) => void,
  setUsage: React.Dispatch<React.SetStateAction<UsageTotals>>,
  setMessages: React.Dispatch<React.SetStateAction<DisplayMessage[]>>,
  setPlan: React.Dispatch<React.SetStateAction<string | null>>
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
      // Session-wide running total for the StatusBar
      setUsage((prev) => ({
        inputTokens: prev.inputTokens + event.inputTokens,
        outputTokens: prev.outputTokens + event.outputTokens,
      }));
      break;
    case "error":
      // Compact + actionable in the transcript (raw provider error walls are
      // multi-line dumps); the error is rendered as its own styled block.
      update((m) => ({
        ...m,
        errorText: friendlyError(event.message),
        toolCalls: m.toolCalls.map((t) =>
          t.status === "running" ? { ...t, status: "error" as const, summary: "Turn failed" } : t
        ),
      }));
      break;
    case "compacted":
      setMessages((prev) => [
        ...prev,
        systemMessage(
          `Conversation compacted to stay within context limits.\n\n${event.summary}`
        ),
      ]);
      break;
    // truthful-engine events — surfaced, never silently dropped.
    case "rate_limit_wait":
      setMessages((prev) => [
        ...prev,
        systemMessage(`Rate limited — waiting ${event.seconds}s, retrying automatically…`),
      ]);
      break;
    case "budget_exhausted":
      setMessages((prev) => [
        ...prev,
        systemMessage(
          'Turn stopped after reaching its step limit. Type "continue" to keep going, or revise the task.'
        ),
      ]);
      break;
    case "loop_detected":
      setMessages((prev) => [
        ...prev,
        systemMessage(
          `Loop guard: ${event.tool} was repeated 3× without progress. Further identical calls are blocked.`
        ),
      ]);
      break;
    case "plan_updated":
      // drive the persistent plan line, not just the transcript.
      setPlan(event.plan || null);
      setMessages((prev) => [...prev, systemMessage(`Plan updated: ${event.plan}`)]);
      break;
    case "checkpoint":
      setMessages((prev) => [
        ...prev,
        systemMessage(
          `Checkpoint #${event.id}: ${event.files} file${event.files === 1 ? "" : "s"} snapshotted — /rewind ${event.id} to undo.`
        ),
      ]);
      break;
    // Delegation renders as cards on the assistant turn —
    // the started card is the live progress, the finished card carries the
    // report (expandable via /expand). Replaces the old system notices.
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
      // A cancelled turn can strand running cards — mark them honestly.
      // (The for-await loop ending still flips streaming/isBusy as before.)
      update((m) => ({
        ...m,
        toolCalls: m.toolCalls.map((t) =>
          t.status === "running" ? { ...t, status: "cancelled" as const, summary: "Cancelled" } : t
        ),
        subAgents: m.subAgents.map((s) => (s.status === "running" ? { ...s, status: "cancelled" } : s)),
      }));
      break;
    // "turn_complete" — no per-message change; the for-await loop ending
    // triggers the finally block that flips streaming/isBusy.
  }
}
