import { useCallback, useEffect, useRef, useState } from "react";
import { randomUUID } from "node:crypto";
import { AgentSession, type AgentEvent } from "@anvil/core";

export interface DisplayToolCall {
  id: string;
  name: string;
  input: unknown;
  status: "running" | "done" | "error";
  summary?: string;
}

export interface DisplayMessage {
  id: string;
  role: "user" | "assistant" | "system";
  text: string; // accumulated so far; may still be mid-stream
  streaming: boolean;
  toolCalls: DisplayToolCall[];
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
  // Phase 8.5 (U1): the persistent plan — seeded from the session, updated live
  // by plan_updated events, reset whenever the active session changes.
  const [plan, setPlan] = useState<string | null>(session.plan ?? null);
  useEffect(() => {
    setPlan(session.plan ?? null);
  }, [session]);

  const send = useCallback(
    async (text: string) => {
      if (isBusy) return; // simplest policy for this phase: ignore input while busy
      setSentHistory((prev) => [...prev, text]); // session-scoped recall history
      const userMsg: DisplayMessage = {
        id: randomUUID(),
        role: "user",
        text,
        streaming: false,
        toolCalls: [],
      };
      const assistantId = randomUUID();
      currentAssistantId.current = assistantId;
      setMessages((prev) => [
        ...prev,
        userMsg,
        { id: assistantId, role: "assistant", text: "", streaming: true, toolCalls: [] },
      ]);
      setIsBusy(true);

      const updateAssistant = (fn: (m: DisplayMessage) => DisplayMessage) => {
        setMessages((prev) => prev.map((m) => (m.id === assistantId ? fn(m) : m)));
      };

      try {
        for await (const event of session.send(text)) {
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
      { id: randomUUID(), role: "system" as const, text, streaming: false, toolCalls: [] },
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
  return { id: randomUUID(), role: "system", text, streaming: false, toolCalls: [] };
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
      update((m) => ({ ...m, text: m.text + `\n[error: ${event.message}]` }));
      break;
    case "compacted":
      setMessages((prev) => [
        ...prev,
        systemMessage(
          `Conversation compacted to stay within context limits.\n\n${event.summary}`
        ),
      ]);
      break;
    // Phase 8 (A): truthful-engine events — surfaced, never silently dropped.
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
      // Phase 8.5 (U1): drive the persistent plan line, not just the transcript.
      setPlan(event.plan || null);
      setMessages((prev) => [...prev, systemMessage(`Plan updated: ${event.plan}`)]);
      break;
    // Phase 9: delegation surfaced as notices; usage flows into the totals.
    case "subagent_started":
      setMessages((prev) => [...prev, systemMessage(`Sub-agent started: ${event.task}`)]);
      break;
    case "subagent_finished":
      setUsage((prev) => ({
        inputTokens: prev.inputTokens + event.inputTokens,
        outputTokens: prev.outputTokens + event.outputTokens,
      }));
      setMessages((prev) => [
        ...prev,
        systemMessage(
          `Sub-agent finished — ${event.toolCalls} tool call${event.toolCalls === 1 ? "" : "s"}, ` +
            `${event.inputTokens.toLocaleString()} in / ${event.outputTokens.toLocaleString()} out tokens.`
        ),
      ]);
      break;
    // "turn_complete", "cancelled" — no per-message change; the for-await loop
    // ending triggers the finally block that flips streaming/isBusy.
  }
}
