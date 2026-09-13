import { getErrorMessage } from "@anvil/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { randomUUID } from "node:crypto";
import {
  AgentSession,
  type AgentEvent,
  runGoalMission,
  MAX_GOAL_TURNS,
  type GoalMilestone,
  type GoalTurnOutcome,
} from "@anvil/core";
import { HISTORY_RECALL_CAP, TRANSCRIPT_STATE_CAP, MESSAGE_QUEUE_CAP } from "../util/displayLimits.js";
import { friendlyError } from "../util/errors.js";
import {
  type DisplaySubAgent,
  type DisplayToolCall,
  type DisplayVerification,
  type DisplayGoalMilestone,
  type DisplayGoal,
  type DisplayMessage,
  type UsageTotals,
  OUTPUT_RETAIN_MAX,
  retainOutput,
  appendSystemMessage,
  applyEvent,
} from "./eventReducer.js";

export {
  type DisplaySubAgent,
  type DisplayToolCall,
  type DisplayVerification,
  type DisplayGoalMilestone,
  type DisplayGoal,
  type DisplayMessage,
  type UsageTotals,
  OUTPUT_RETAIN_MAX,
  retainOutput,
};

/**
 * Bridges AgentSession's async generator into React state. Every event handler
 * does a full setMessages map (never in-place mutation) so React re-renders.
 */
export interface UseAgentControllerOptions {
  /** Called after every settled turn (completion, cancel, or error) — used to persist. */
  onTurnSettled?: () => void;
}

export function useAgentController(session: AgentSession, opts: UseAgentControllerOptions = {}) {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const [usage, setUsage] = useState<UsageTotals>({ inputTokens: 0, outputTokens: 0 });
  // Messages typed while a turn runs queue here and drain automatically
  // when the turn settles — typing ahead used to bounce off with a notice.
  const queueRef = useRef<string[]>([]);
  const [queued, setQueued] = useState<string[]>([]);
  const busyRef = useRef(false);
  // /image attachments waiting for the next send (consumed by runTurn).
  const pendingImagesRef = useRef<{ mediaType: string; data: string; path: string }[]>([]);
  const onTurnSettledRef = useRef(opts.onTurnSettled);
  onTurnSettledRef.current = opts.onTurnSettled;
  const [sentHistory, setSentHistory] = useState<string[]>([]);
  // the persistent plan — seeded from the session, updated live
  // by plan_updated events, reset whenever the active session changes.
  const [plan, setPlan] = useState<string | null>(session.plan ?? null);
  const [goal, setGoal] = useState<DisplayGoal | null>(null);
  const [testStatus, setTestStatus] = useState<"green" | "failed" | "running" | null>(null);
  useEffect(() => {
    setPlan(session.plan ?? null);
    setGoal(null);
    setTestStatus(null);
    // Usage totals belong to the session too — a fresh/cleared transcript
    // must not show the previous session's spend in the StatusBar.
    setUsage({ inputTokens: 0, outputTokens: 0 });
    // Queued messages belong to the conversation they were typed in.
    queueRef.current = [];
    setQueued([]);
    pendingImagesRef.current = [];
  }, [session]);

  // Stream delta backpressure buffer timer ref (cleaned up on unmount)
  const flushTimerRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    return () => {
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
    };
  }, []);

  const recordSentMessage = useCallback((text: string) => {
    setSentHistory((prev) => (prev[prev.length - 1] === text ? prev : [...prev, text].slice(-HISTORY_RECALL_CAP)));
  }, []);

  const runTurn = useCallback(
    async (text: string) => {
      // busyRef belongs to the caller (send's claim covers the whole drain —
      // toggling it here opened a window where two sends ran concurrently).
      const attached = pendingImagesRef.current;
      pendingImagesRef.current = [];
      // Bounded state: recall needs dozens, not thousands; the transcript window
      // renders a handful while history truth lives in the session file.
      recordSentMessage(text);
      const userMsg: DisplayMessage = {
        id: randomUUID(),
        role: "user",
        text,
        streaming: false,
        toolCalls: [],
        subAgents: [],
        verifications: [],
        ...(attached.length > 0 ? { images: attached.map((a) => ({ path: a.path })) } : {}),
      };
      const assistantId = randomUUID();
      setMessages((prev) => {
        const next: DisplayMessage[] = [
          ...prev,
          userMsg,
          { id: assistantId, role: "assistant", text: "", streaming: true, toolCalls: [], subAgents: [], verifications: [] },
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
      let textBuffer = "";
      const flushTextBuffer = () => {
        if (flushTimerRef.current) {
          clearTimeout(flushTimerRef.current);
          flushTimerRef.current = null;
        }
        if (!textBuffer) return;
        const chunk = textBuffer;
        textBuffer = "";
        updateAssistant((m) => ({ ...m, text: m.text + chunk }));
      };

      try {
        for await (const event of session.send(text, attached)) {
          if (event.type === "text_delta") {
            if (textNeedsBreak) {
              textBuffer += "\n\n";
              textNeedsBreak = false;
            }
            textBuffer += event.text;
            if (!flushTimerRef.current) {
              flushTimerRef.current = setTimeout(() => {
                flushTimerRef.current = null;
                if (textBuffer) {
                  const chunk = textBuffer;
                  textBuffer = "";
                  updateAssistant((m) => ({ ...m, text: m.text + chunk }));
                }
              }, 16); // 60 FPS throttle window (~16ms)
            }
          } else {
            // Any non-text event (tool call, turn end) immediately flushes pending text
            flushTextBuffer();
            if (event.type === "tool_finished" || event.type === "tool_permission_denied") {
              textNeedsBreak = true;
            }
            applyEvent(event, updateAssistant, setUsage, setMessages, setPlan, setTestStatus);
          }
        }
      } catch (err: unknown) {
        flushTextBuffer();
        const msg = getErrorMessage(err);
        updateAssistant((m) => ({
          ...m,
          errorText: friendlyError(msg),
        }));
      } finally {
        flushTextBuffer();
        // Mark streaming done either way — completion, cancellation, or error.
        updateAssistant((m) => ({ ...m, streaming: false }));
        setIsBusy(false);
        onTurnSettledRef.current?.();
      }
    },
    [session]
  );

  /** Append a system notice to the transcript — never sent to the model. */
  const printSystemMessage = useCallback((text: string) => {
    appendSystemMessage(
      setMessages,
      text
    );
  }, []);

  /** Drain queued messages after the current turn settles. The caller owns
   *  the busyRef claim: runTurn's finally clears it, but the drain re-checks
   *  and re-enters runTurn in the same synchronous continuation, so a user
   *  send() can never observe the window between turns (that window used to
   *  let a second send start a concurrent turn on one session). */
  const drainQueue = useCallback(async () => {
    while (queueRef.current.length > 0) {
      const [next, ...rest] = queueRef.current;
      queueRef.current = rest;
      setQueued(rest);
      await runTurn(next);
    }
  }, [runTurn]);

  /** Drain queued messages after the current turn settles. */
  const send = useCallback(
    async (text: string) => {
      if (busyRef.current) {
        const next = [...queueRef.current, text];
        // A silently dropped head looked like the message never existed.
        if (next.length > MESSAGE_QUEUE_CAP) {
          printSystemMessage("Queue full — dropped the oldest queued message.");
        }
        queueRef.current = next.slice(-MESSAGE_QUEUE_CAP);
        setQueued([...queueRef.current]);
        return;
      }
      busyRef.current = true;
      try {
        await runTurn(text);
        await drainQueue();
      } finally {
        busyRef.current = false;
      }
    },
    [runTurn, drainQueue, printSystemMessage]
  );

  /** Stage an image for the next message (/image). Capped at 4 pending. */
  const addPendingImage = useCallback((img: { mediaType: string; data: string; path: string }) => {
    pendingImagesRef.current = [...pendingImagesRef.current, img].slice(-4);
  }, []);

  const cancel = useCallback(() => session.cancel(), [session]);

  /** Clear the visible transcript (pairs with session.clearHistory() for /clear). */
  const clearMessages = useCallback(() => {
    setMessages([]);
  }, []);

  /** Seed the transcript (e.g. when resuming a stored session). */
  const replaceMessages = useCallback((seed: DisplayMessage[]) => {
    setMessages(seed);
  }, []);

  /**
   * Run one mission turn without a user bubble — the mission deck and system
   * notices carry the context; the assistant card renders text and tool calls.
   * Collects the outcome signals the goal mission judges milestones on.
   * `onEvent` lets launchGoal update the deck's live detail line while the
   * turn streams (the mission protocol's own progress events never reach the
   * TUI — its injected sendTurn consumes the session's events directly).
   */
  const runGoalTurn = useCallback(
    async (
      prompt: string,
      onEvent?: (event: AgentEvent) => void
    ): Promise<GoalTurnOutcome> => {
      // busy/isBusy are owned by launchGoal for the whole mission — toggling
      // per turn let user input slip into the gaps between mission turns.
      const assistantId = randomUUID();
      setMessages((prev) => {
        const next: DisplayMessage[] = [
          ...prev,
          { id: assistantId, role: "assistant", text: "", streaming: true, toolCalls: [], subAgents: [], verifications: [] },
        ];
        return next.length > TRANSCRIPT_STATE_CAP ? next.slice(-TRANSCRIPT_STATE_CAP) : next;
      });

      const updateAssistant = (fn: (m: DisplayMessage) => DisplayMessage) => {
        setMessages((prev) => prev.map((m) => (m.id === assistantId ? fn(m) : m)));
      };

      const outcome: GoalTurnOutcome = {
        text: "",
        errored: false,
        verificationFailed: false,
        permissionDenied: false,
        cancelled: false,
      };
      let textNeedsBreak = false;
      let textBuffer = "";
      const flushTextBuffer = () => {
        if (flushTimerRef.current) {
          clearTimeout(flushTimerRef.current);
          flushTimerRef.current = null;
        }
        if (!textBuffer) return;
        const chunk = textBuffer;
        textBuffer = "";
        updateAssistant((m) => ({ ...m, text: m.text + chunk }));
      };

      try {
        for await (const event of session.send(prompt)) {
          if (event.type === "text_delta") {
            if (textNeedsBreak) {
              textBuffer += "\n\n";
              textNeedsBreak = false;
            }
            textBuffer += event.text;
            outcome.text += event.text;
            if (!flushTimerRef.current) {
              flushTimerRef.current = setTimeout(() => {
                flushTimerRef.current = null;
                if (textBuffer) {
                  const chunk = textBuffer;
                  textBuffer = "";
                  updateAssistant((m) => ({ ...m, text: m.text + chunk }));
                }
              }, 16); // 60 FPS throttle window (~16ms)
            }
          } else {
            // Any non-text event (tool call, turn end) immediately flushes pending text
            flushTextBuffer();
            if (event.type === "tool_finished" || event.type === "tool_permission_denied") {
              textNeedsBreak = true;
            }
            if (event.type === "verification_result" && !event.passed) outcome.verificationFailed = true;
            if (event.type === "tool_permission_denied") outcome.permissionDenied = true;
            if (event.type === "error") outcome.errored = true;
            if (event.type === "cancelled") outcome.cancelled = true;
            applyEvent(event, updateAssistant, setUsage, setMessages, setPlan, setTestStatus);
          }
          onEvent?.(event);
        }
      } catch (err: unknown) {
        flushTextBuffer();
        outcome.errored = true;
        const msg = getErrorMessage(err);
        updateAssistant((m) => ({
          ...m,
          errorText: friendlyError(msg),
        }));
      } finally {
        flushTextBuffer();
        updateAssistant((m) => ({ ...m, streaming: false }));
        onTurnSettledRef.current?.();
      }
      return outcome;
    },
    [session]
  );

  /**
   * Launch an autonomous goal over the LIVE session: the real GoalEngine
   * mission protocol drives turns through this session, so tool cards render
   * in the transcript while the Mission Deck reflects genuine milestone
   * evidence (no more hardcoded fake deck).
   *
   * busyRef stays claimed for the WHOLE mission: a message typed in the gap
   * between two mission turns must queue, not interleave — a colliding turn
   * used to come back errored and mark an innocent milestone failed.
   */
  const launchGoal = useCallback(
    async (objective: string) => {
      if (busyRef.current) {
        printSystemMessage("Finish or cancel the current turn before starting a mission.");
        return;
      }
      busyRef.current = true;
      setIsBusy(true);
      setGoal(null);
      // Live deck detail: mirror the goal engine's milestone_progress onto the
      // milestone that owns the running turn.
      const missionMilestone: { current: string | null } = { current: null };
      const onMissionEvent = (event: AgentEvent) => {
        const milestoneId = missionMilestone.current;
        if (!milestoneId) return;
        let detail: string | undefined;
        if (event.type === "tool_started") detail = `Running ${event.name}...`;
        else if (event.type === "verification_started") detail = "Running automated test verification...";
        else if (event.type === "verification_gave_up")
          detail = "Auto-verification gave up — repair budget exhausted.";
        else if (event.type === "verification_result")
          detail = event.passed ? "Automated verification passed." : "Automated verification FAILED.";
        if (!detail) return;
        setGoal((prev) =>
          prev
            ? {
                ...prev,
                milestones: prev.milestones.map((m) =>
                  m.id === milestoneId ? { ...m, detail } : m
                ),
              }
            : prev
        );
      };
      const mission = runGoalMission(objective, {
        projectRoot: session.projectRoot,
        summarizeChanges: () => session.summarizeChanges(),
        sendTurn: async function* (prompt: string, milestone: GoalMilestone | null) {
          missionMilestone.current = milestone?.id ?? null;
          try {
            const outcome = await runGoalTurn(prompt, onMissionEvent);
            return outcome;
          } finally {
            missionMilestone.current = null;
          }
        },
      });
      try {
        for await (const ge of mission) {
          switch (ge.type) {
            case "plan_decomposed":
              setGoal({
                title: objective,
                milestones: ge.milestones.map((m) => ({
                  id: m.id,
                  title: m.title,
                  criteria: m.criteria,
                  status: m.status as DisplayGoalMilestone["status"],
                })),
                currentTurn: 1,
                maxTurns: MAX_GOAL_TURNS,
              });
              break;
            case "milestone_started":
              setGoal((prev) =>
                prev
                  ? {
                      ...prev,
                      currentTurn: prev.currentTurn + 1,
                      milestones: prev.milestones.map((m) =>
                        m.id === ge.milestone.id ? { ...m, status: "in_progress" as const } : m
                      ),
                    }
                  : prev
              );
              break;
            case "milestone_completed":
              setGoal((prev) =>
                prev
                  ? {
                      ...prev,
                      milestones: prev.milestones.map((m) =>
                        m.id === ge.milestone.id ? { ...m, status: "completed" as const, detail: undefined } : m
                      ),
                    }
                  : prev
              );
              break;
            case "milestone_failed":
              setGoal((prev) =>
                prev
                  ? {
                      ...prev,
                      milestones: prev.milestones.map((m) =>
                        m.id === ge.milestone.id ? { ...m, status: "failed" as const } : m
                      ),
                    }
                  : prev
              );
              printSystemMessage(`✗ Milestone ${ge.milestone.id} failed: ${ge.error}`);
              break;
            case "critique_result":
              printSystemMessage(`🔍 Self-critique: ${ge.verdict}`);
              break;
            case "goal_failed":
              printSystemMessage(`✗ Mission failed: ${ge.error}`);
              break;
            case "goal_completed":
              setGoal((prev) =>
                prev
                  ? {
                      ...prev,
                      milestones: ge.result.milestones.map((m) => ({
                        id: m.id,
                        title: m.title,
                        criteria: m.criteria,
                        status: m.status as DisplayGoalMilestone["status"],
                      })),
                    }
                  : prev
              );
              printSystemMessage(
                `${ge.result.success ? "✔" : "✗"} Mission ${ge.result.success ? "accomplished" : "ended"}: ` +
                  `${ge.result.summary} Files changed: ${ge.result.filesChanged.length}.`
              );
              break;
            default:
              break;
          }
        }
      } catch (err: unknown) {
        printSystemMessage(`Mission error: ${getErrorMessage(err)}`);
      } finally {
        setIsBusy(false);
        // Messages typed between mission turns queued — deliver them now,
        // while we still hold the busy claim.
        await drainQueue();
        busyRef.current = false;
      }
    },
    [session, runGoalTurn, printSystemMessage, drainQueue]
  );

  return {
    messages,
    isBusy,
    usage,
    plan,
    goal,
    setGoal,
    testStatus,
    setTestStatus,
    queued,
    send,
    launchGoal,
    addPendingImage,
    cancel,
    printSystemMessage,
    clearMessages,
    replaceMessages,
    sentHistory,
    recordSentMessage,
  };
}
