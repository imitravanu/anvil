import { describe, expect, it } from "vitest";
import { HistoryStore } from "../historyStore.js";
import { TurnState } from "../turnState.js";
import type { AccumulatedToolCall, PreparedCall } from "../loopGuard.js";
import type { ToolExecutionResult } from "../../tools/types.js";
import type { ConversationMessage } from "../../providers/types.js";

/**
 * PROPERTY TESTS — history invariants under random-but-seeded event orders.
 *
 * These rules are pinned elsewhere only by examples, and N-1 (an empty assistant
 * turn produced `user -> user` adjacency, which several providers reject) is
 * exactly the class examples miss. This suite drives the SAME operation order
 * the session uses — a user turn, then [assistant round + tool results]*, ending
 * in a text answer, a budget notice, or cancellation — and checks the
 * invariants after EVERY step, not just at the end.
 *
 * Seeded LCG, never Math.random: a failure must be reproducible from the printed
 * seed. No property-testing dependency (the repo adds no deps by default).
 */

/** mulberry32 — small, fast, and trivially seedable. */
function lcg(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function preparedFor(call: AccumulatedToolCall): PreparedCall {
  return {
    call,
    def: undefined,
    key: `read_file:${call.id}`,
    refused: false,
    loopWarn: false,
    repeatWarn: false,
  };
}

function toolCallsOf(message: { content: readonly unknown[] }): AccumulatedToolCall[] {
  return message.content
    .filter((c): c is { type: "tool_call"; call: AccumulatedToolCall } =>
      typeof c === "object" && c !== null && (c as { type?: unknown }).type === "tool_call"
    )
    .map((c) => c.call);
}

function resultIdsOf(message: { content: readonly unknown[] }): string[] {
  return message.content
    .filter((c): c is { type: "tool_result"; result: { toolCallId: string } } =>
      typeof c === "object" && c !== null && (c as { type?: unknown }).type === "tool_result"
    )
    .map((c) => c.result.toolCallId);
}

/**
 * The invariants, asserted after every mutation:
 *  1. no message carries empty content (an empty message corrupts replay);
 *  2. every tool_call is answered, in the next message, before another assistant turn;
 *  3. no two adjacent messages share a role;
 *  4. tool results appear in DECLARED call order (provider replay stability).
 * (Idempotent repair is asserted separately, on a crashed history.)
 *
 * `pendingCalls` marks the one legitimate transient: between pushAssistant and
 * pushToolResults the batch is still executing, so the LAST message's tool
 * calls are legitimately unanswered. Every EARLIER message must still be fully
 * paired — that is the invariant that actually matters at turn settle.
 */
function assertInvariants(
  h: HistoryStore,
  seed: number,
  step: string,
  pendingCalls = false
): void {
  const msgs = h.snapshot();
  const where = `seed=${seed} ${step}`;
  msgs.forEach((m, i) => {
    expect(m.content.length, `${where}: message ${i} is empty`).toBeGreaterThan(0);
  });
  const pairedUpTo = pendingCalls ? msgs.length - 1 : msgs.length;
  for (let i = 0; i < pairedUpTo; i++) {
    const calls = toolCallsOf(msgs[i]);
    if (calls.length === 0) continue;
    const next = msgs[i + 1];
    expect(next, `${where}: tool_call at ${i} has no following result message`).toBeDefined();
    expect(next.role, `${where}: tool results must ride a user turn`).toBe("user");
    const ids = resultIdsOf(next);
    expect(ids, `${where}: results are not in declared call order`).toEqual(calls.map((c) => c.id));
    expect(new Set(ids).size, `${where}: a tool_call was answered twice`).toBe(ids.length);
  }
  for (let i = 1; i < msgs.length; i++) {
    expect(msgs[i].role, `${where}: same-role adjacency at message ${i}`).not.toBe(msgs[i - 1].role);
  }
}

const SEQUENCES = 200;

function runSequence(seed: number): void {
  const rand = lcg(seed);
  const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)] as T;
  const h = new HistoryStore();
  // A mid-turn snapshot, used to model a real crash: a session torn down between
  // an assistant tool_call and its results (what a restored session from a killed
  // process actually looks like).
  let crashed: ConversationMessage[] | null = null;

  const turns = 1 + Math.floor(rand() * 3);
  for (let t = 0; t < turns; t++) {
    // A fresh TurnState per send() is what the session does — the budget must
    // never leak across turns.
    const turn = new TurnState(2);
    h.pushUserText(pick(["hi", "fix the bug", "again please", "x".repeat(64), "继续"]));
    assertInvariants(h, seed, `t${t}/user`);

    for (let round = 0; ; round++) {
      if (turn.checkBudget()) {
        h.pushBudgetNotice(2);
        assertInvariants(h, seed, `t${t}/budget`);
        break;
      }
      turn.markIteration();

      // An empty assistant turn is REAL: a provider can stop with no content
      // (length cutoff, a filter, or nothing to say). It is the N-1 trigger.
      const emptyTurn = rand() < 0.25;
      const callCount = emptyTurn ? 0 : Math.floor(rand() * 3);
      const calls: AccumulatedToolCall[] = Array.from({ length: callCount }, (_, i) => ({
        id: `s${seed}t${t}r${round}c${i}`,
        name: "read_file",
        input: { path: `f${i}.ts` },
      }));
      const text = emptyTurn || rand() < 0.3 ? [] : [pick(["working on it", "done", "partial result"])];
      h.pushAssistant(text, calls);
      // The batch is in flight here: its calls are legitimately pending.
      assertInvariants(h, seed, `t${t}/r${round}/assistant`, true);

      if (calls.length === 0) break; // terminal turn

      // Crash window: leave the tool calls unanswered, exactly as a killed
      // process would.
      if (crashed === null && rand() < 0.15) {
        crashed = h.snapshot();
      }

      // Cancellation: the session pushes a synthetic result for EVERY pending
      // call (pushCancelledToolResults), so pairing still holds — a genuinely
      // missing result is a crash, not a cancel.
      const cancelled = rand() < 0.2;
      const outcomes = new Map<string, ToolExecutionResult>();
      for (const c of calls) {
        outcomes.set(
          c.id,
          cancelled
            ? {
                output: { error: "Cancelled by user before this tool could run." },
                isError: true,
                summary: "Cancelled.",
              }
            : { output: { ok: true }, isError: false, summary: "ok" }
        );
      }
      const notes = rand() < 0.3 ? ["[Loop guard] read_file was repeated 3 times."] : [];
      h.pushToolResults(calls.map(preparedFor), outcomes, notes);
      assertInvariants(h, seed, `t${t}/r${round}/results`);
    }

    // TURN EXIT — the session closes the turn exactly here (send()'s finally).
    // Closing mid-turn would be wrong: the next round's assistant message would
    // then follow the marker. This is the N-1 ownership rule; the T5 fold only
    // covers a trailing user TEXT turn, and a tool-results turn must never be
    // folded into.
    h.closeOpenTurn();
    assertInvariants(h, seed, `t${t}/closed`);
  }

  // A restored, mid-turn history must be closable EXACTLY once (idempotent).
  if (crashed) {
    const restored = new HistoryStore(crashed);
    expect(restored.repairUnclosedToolCalls("process exited"), `seed=${seed}: a crashed history must report a repair`).toBe(true);
    assertInvariants(restored, seed, "after-repair");
    const lengthAfterFirst = restored.length;
    expect(restored.repairUnclosedToolCalls("process exited again"), `seed=${seed}: repair is not idempotent`).toBe(false);
    expect(restored.length, `seed=${seed}: a second repair changed the history`).toBe(lengthAfterFirst);
  }
}

describe("HistoryStore invariants (seeded property sequences)", () => {
  it(`holds across ${SEQUENCES} seeded event orders`, () => {
    for (let seed = 1; seed <= SEQUENCES; seed++) {
      runSequence(seed);
    }
  });
});
