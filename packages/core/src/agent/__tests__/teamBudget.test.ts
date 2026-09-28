import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AgentSession, type AgentEvent, type AgentOptions } from "../index.js";
import { FakeProvider, type ScriptEntry } from "./fakeProvider.js";
import type { StreamEvent, CompletionRequest } from "../../providers/types.js";

let root: string;

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "anvil-team-budget-"));
});

afterAll(() => fs.rm(root, { recursive: true, force: true }));

function makeSession(script: ScriptEntry[], opts?: Partial<AgentOptions>) {
  const provider = new FakeProvider(script);
  const session = new AgentSession(provider, {
    systemPrompt: "test",
    model: "fake-model",
    maxTokens: 1024,
    projectRoot: root,
    permissionBroker: { async requestPermission() { return true; } },
    ...opts,
  });
  return { provider, session };
}

async function collect(gen: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

function readTurn(file: string, id: string): StreamEvent[] {
  return [
    { type: "tool_call_end", id, name: "read_file", input: { path: file } },
    { type: "turn_end", stopReason: "tool_use" },
  ];
}

function textTurn(text = "Done."): StreamEvent[] {
  return [{ type: "text_delta", text }, { type: "turn_end", stopReason: "end_turn" }];
}

function teamTurn(team: unknown): StreamEvent[] {
  return [
    { type: "tool_call_end", id: "t0", name: "delegate_task", input: { task: "ship it", team } },
    { type: "turn_end", stopReason: "tool_use" },
  ];
}

/** Provider calls whose user prompt is the given task — i.e. that member's sub-session turns. */
function callsForTask(provider: FakeProvider, task: string) {
  return provider.calls.filter((c) => {
    const first = c.messages[0]?.content[0];
    return first?.type === "text" && first.text === task;
  });
}

describe("Phase 35 — per-tool streaming across members", () => {
  it("streams a member's tool progress while that member is stalled mid-run", async () => {
    const file = path.join(root, "d.txt");
    // One member reads a file (emitting subagent_progress) and then STALLS in
    // its next provider call; the other member is tool-free so ANY progress
    // event in the parent stream belongs to the stalled member. Under Phase 34
    // per-member batching the progress event was buffered until the member
    // FINISHED — which never happens here before the watchdog — so this test
    // fails against batching and passes only with per-tool streaming.
    // The stall releases ONLY when the test calls release() — the provider
    // request's own signal (used as a safety net) fires only if the session
    // cancels, which the test does not do.
    let release: () => void = () => {};
    const { session } = makeSession([
      teamTurn({
        // PIPELINE, not parallel: serial handoff guarantees member a consumes
        // the first member entry and member b the second. Under parallel, the
        // fake's shared script is consumed in call order and the assignment is
        // timing-dependent — which silently invalidated the first draft of
        // this test (it passed against the old batching for the wrong reason).
        strategy: "pipeline",
        totalIterations: 4, // split [2, 2]: member a must reach its second call
        members: [
          { id: "a", task: "task-a" },
          { id: "b", task: "task-b" },
        ],
      }),
      // Member a, turn 1: one tool call → its progress event.
      readTurn(file, "s0"),
      // Member a, turn 2: STALL until the test releases it.
      (request: CompletionRequest) =>
        (async function* () {
          await new Promise<void>((resolve) => {
            release = resolve;
            if (request.signal?.aborted) resolve();
            else request.signal?.addEventListener("abort", () => resolve(), { once: true });
          });
        })(),
      // Member b (starts only after a's handoff): tool-free, ends immediately.
      textTurn("done quick"),
      // Parent-final.
      textTurn(),
    ]);

    // Safety release so a structural surprise can never hang the suite past
    // vitest's timeout.
    const safety = setTimeout(() => release(), 8000);
    try {
      const collected: AgentEvent[] = [];
      // Race so the observation window is explicit: after 1s the member is
      // still stalled and we check what streamed DURING the stall.
      const timeout = new Promise<{ timedOut: boolean }>((resolve) =>
        setTimeout(() => resolve({ timedOut: true }), 1000)
      );
      const consume = (async () => {
        for await (const ev of session.send("go")) collected.push(ev);
        return { timedOut: false };
      })();
      const outcome = await Promise.race([consume, timeout]);

      // THE discriminator: the member is still stalled at this point (released
      // below), yet its tool progress must already have reached the stream.
      // Phase 34 batching flushed progress only at member_finished — which
      // cannot happen while the member is stalled — so this assertion is the
      // one that fails against batching.
      const sawProgress = collected.some((e) => e.type === "subagent_progress");
      expect(
        sawProgress,
        "no tool progress surfaced while the member was still running"
      ).toBe(true);

      // Now let the stalled member finish and drain the whole stream.
      release();
      await consume;
      expect(collected.filter((e) => e.type === "subagent_started").length).toBe(2);
      expect(collected.filter((e) => e.type === "subagent_finished").length).toBe(2);
      void outcome;
    } finally {
      clearTimeout(safety);
      release();
    }
  }, 10_000);
});

describe("Phase 34 — live cross-member streaming (delegate_task team run)", () => {
  it("interleaves members: member B starts before member A finishes", async () => {
    const file = path.join(root, "b.txt");
    const { session } = makeSession([
      teamTurn({
        strategy: "parallel",
        totalIterations: 2, // split [1, 1]
        members: [
          { id: "a", task: "task-a" },
          { id: "b", task: "task-b" },
        ],
      }),
      // Member A's single tool turn.
      readTurn(file, "a0"),
      // Member B's single tool turn.
      readTurn(file, "b0"),
      textTurn(),
    ]);

    const events = await collect(session.send("go"));
    const starts = events.filter((e) => e.type === "subagent_started");
    const finishes = events.filter((e) => e.type === "subagent_finished");
    expect(starts.length).toBe(2);
    expect(finishes.length).toBe(2);

    // THE discriminator, grounded in the mechanism. The old code buffered each
    // member's events and drained them per member AFTER the team settled, so
    // the stream grouped by member: A-start … A-finish … B-start … B-finish.
    // Live streaming emits both starts while both members are still in flight,
    // so member B's start must now appear BEFORE member A's finish. The first
    // start is member A's (its task text matches the first member spec).
    const firstStart = events.findIndex((e) => e.type === "subagent_started");
    const firstFinish = events.findIndex((e) => e.type === "subagent_finished");
    const secondStart = events.findIndex(
      (e, i) => e.type === "subagent_started" && i > firstStart
    );
    expect(
      secondStart,
      "expected two subagent_started events"
    ).toBeGreaterThan(firstStart);
    expect(
      secondStart < firstFinish,
      "member B started only after member A finished — streaming is still batched"
    ).toBe(true);
  });

  it("a member whose provider script is exhausted fails without laundering success", async () => {
    const file = path.join(root, "c.txt");
    // Deliberately ONE member turn short: member b's sub-session throws
    // FakeProvider: script exhausted, and its report names that failure. The
    // tool result must carry it — isError true, no laundered success.
    const { session } = makeSession([
      teamTurn({
        strategy: "parallel",
        totalIterations: 2,
        members: [
          { id: "a", task: "task-a" },
          { id: "b", task: "task-b" },
        ],
      }),
      readTurn(file, "a0"),
      // no script left for member b → its sub-session errors
    ]);

    const events: AgentEvent[] = [];
    for await (const ev of session.send("go")) events.push(ev);

    // Both members announced — a failed member is not silently dropped.
    expect(events.filter((e) => e.type === "subagent_started").length).toBe(2);
    expect(events.filter((e) => e.type === "subagent_finished").length).toBe(2);

    // delegate_task is a session tool: its result reaches the model via the
    // tool_result in history, NOT a tool_finished event (phase-8 contract).
    // The honest observable for failure is the run ledger.
    const ledger = session.getRunLedger();
    expect(
      ledger.some((e) => e.eventType === "subagent_finished" && e.outcome === "error"),
      "a member's failure must surface as an errored subagent_finished ledger entry"
    ).toBe(true);
    expect(ledger.some((e) => e.eventType === "subagent_finished" && e.outcome === "ok")).toBe(true);
  });
});

describe("team budget enforcement (delegate_task → runTeam → sub-agents)", () => {
  // Note: all members share one FakeProvider script queue (consumed in call
  // order), so each member's script is exactly its budget size — leftovers
  // would be consumed by the parent turn and skew the counts.
  it("each member stops at its split share of totalIterations", async () => {
    const file = path.join(root, "a.txt");
    const { provider, session } = makeSession([
      teamTurn({
        strategy: "parallel",
        totalIterations: 2, // split [1, 1] across two members
        members: [
          { id: "a", task: "task-a" },
          { id: "b", task: "task-b" },
        ],
      }),
      // sub a (budget 1): one iteration, then budget_exhausted ends the sub-run
      readTurn(file, "a0"),
      // sub b (budget 1): same
      readTurn(file, "b0"),
      // parent-final
      textTurn("team finished"),
    ]);

    await collect(session.send("run the team"));

    // parent team turn + one iteration each + parent-final = 4 total calls
    // (pre-fix this was 10: the sub-sessions burned the entire script).
    expect(provider.calls).toHaveLength(4);
    expect(callsForTask(provider, "task-a")).toHaveLength(1);
    expect(callsForTask(provider, "task-b")).toHaveLength(1);
  });

  it("an explicit per-member maxInnerIterations override wins over the even split", async () => {
    const file = path.join(root, "b.txt");
    const { provider, session } = makeSession([
      teamTurn({
        strategy: "parallel",
        totalIterations: 3, // even split would be [2, 1]
        members: [
          { id: "a", task: "task-a" },
          { id: "b", task: "task-b", maxInnerIterations: 2 },
        ],
      }),
      // sub a (split share 2): two iterations
      readTurn(file, "a0"),
      readTurn(file, "a1"),
      // sub b (override 2 > its split share of 1): two iterations
      readTurn(file, "b0"),
      readTurn(file, "b1"),
      // parent-final
      textTurn("team finished"),
    ]);

    await collect(session.send("run the team"));

    expect(callsForTask(provider, "task-a")).toHaveLength(2);
    expect(callsForTask(provider, "task-b")).toHaveLength(2);
    // parent + 2 + 2 + parent-final
    expect(provider.calls).toHaveLength(6);
  });
});
