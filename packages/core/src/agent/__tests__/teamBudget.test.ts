import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AgentSession, type AgentEvent, type AgentOptions } from "../index.js";
import { FakeProvider, type ScriptEntry } from "./fakeProvider.js";
import type { StreamEvent } from "../../providers/types.js";

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
