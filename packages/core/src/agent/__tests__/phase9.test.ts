import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AgentSession, type AgentEvent, type AgentOptions } from "../index.js";
import { FakeProvider, stalledStream, type ScriptEntry } from "./fakeProvider.js";
import {
  capReport,
  subAgentTools,
  MAX_DELEGATIONS_PER_TURN,
  SUB_AGENT_REPORT_MAX_CHARS,
} from "../subagent.js";
import { TOOL_DEFINITIONS } from "../../tools/index.js";
import type { StreamEvent } from "../../providers/types.js";

let root: string;

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "anvil-phase9-"));
});
afterAll(() => fs.rm(root, { recursive: true, force: true }));

function makeSession(script: ScriptEntry[], broker?: AgentOptions["permissionBroker"]) {
  const provider = new FakeProvider(script);
  const session = new AgentSession(provider, {
    systemPrompt: "test",
    model: "fake-model",
    maxTokens: 1024,
    projectRoot: root,
    permissionBroker: broker ?? { async requestPermission() { return true; } },
  });
  return { provider, session };
}

async function collect(gen: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

function delegateCall(id: string, task: string): StreamEvent[] {
  return [
    { type: "tool_call_start", id, name: "delegate_task" },
    { type: "tool_call_end", id, name: "delegate_task", input: { task } },
  ];
}

function subTurn(report: string, usage?: { in: number; out: number }): StreamEvent[] {
  return [
    { type: "text_delta", text: report },
    ...(usage ? [{ type: "usage", inputTokens: usage.in, outputTokens: usage.out } as StreamEvent] : []),
    { type: "turn_end", stopReason: "end_turn" },
  ];
}

/** The tool_result payloads the NEXT provider call was given, in declared order. */
function toolResultsOf(provider: FakeProvider, callIndex: number) {
  const msg = provider.calls[callIndex].messages.at(-1)!;
  return msg.content.map((part: any) => ({
    toolCallId: part.result.toolCallId as string,
    output: JSON.parse(part.result.content),
    isError: part.result.isError as boolean,
  }));
}

describe("Phase 9: sub-agent delegation", () => {
  it("P9-1: round-trip — report returns as tool_result; start/finish events; 3 provider calls", async () => {
    const { provider, session } = makeSession([
      // main turn: the model delegates
      [
        ...delegateCall("d1", "find the provider registry"),
        { type: "turn_end", stopReason: "tool_use" },
      ],
      // sub-agent turn: reports and ends
      subTurn("Found it: providers/registry.ts", { in: 40, out: 9 }),
      // main-final turn
      [
        { type: "text_delta", text: "It lives in providers/registry.ts." },
        { type: "turn_end", stopReason: "end_turn" },
      ],
    ]);
    const events = await collect(session.send("where is the provider registry?"));
    const types = events.map((e) => e.type);

    // Events: started before finished, turn completes at the end
    expect(events.find((e) => e.type === "subagent_started")).toEqual({
      type: "subagent_started",
      task: "find the provider registry",
    });
    expect(events.find((e) => e.type === "subagent_finished")).toEqual({
      type: "subagent_finished",
      toolCalls: 0,
      inputTokens: 40,
      outputTokens: 9,
    });
    expect(types.indexOf("subagent_started")).toBeLessThan(types.indexOf("subagent_finished"));
    expect(types[types.length - 1]).toBe("turn_complete");

    // Provider call count = main + sub + main-final
    expect(provider.calls).toHaveLength(3);

    // The sub ran with the same model and a FRESH context — only its task
    expect(provider.calls[1].model).toBe("fake-model");
    expect(provider.calls[1].messages).toEqual([
      { role: "user", content: [{ type: "text", text: "find the provider registry" }] },
    ]);

    // The report came back to the main model as the delegate_task tool result
    const [result] = toolResultsOf(provider, 2);
    expect(result.toolCallId).toBe("d1");
    expect(result.isError).toBe(false);
    expect(result.output).toEqual({ report: "Found it: providers/registry.ts" });

    // Ledger: explicit sub tokens ride the subagent_finished entry (record, never predict)
    const fin = session.getRunLedger().find((e) => e.eventType === "subagent_finished");
    expect(fin?.tokens).toEqual({ in: 40, out: 9 });
  });

  it("P9-2: depth guard — a sub-agent's delegate_task is refused, no nested run", async () => {
    const { provider, session } = makeSession([
      [
        ...delegateCall("d1", "investigate deeply"),
        { type: "turn_end", stopReason: "tool_use" },
      ],
      // sub turn 1: misbehaving model tries to delegate further
      [
        ...delegateCall("sd1", "recurse!"),
        { type: "turn_end", stopReason: "tool_use" },
      ],
      // sub turn 2: model accepts the refusal and reports
      subTurn("Cannot delegate; investigated directly."),
      // main-final turn
      [
        { type: "text_delta", text: "wrapped up" },
        { type: "turn_end", stopReason: "end_turn" },
      ],
    ]);
    const events = await collect(session.send("investigate"));
    const types = events.map((e) => e.type);

    // Exactly ONE pair of sub-agent events — nothing nested
    expect(types.filter((t) => t === "subagent_started")).toHaveLength(1);
    expect(types.filter((t) => t === "subagent_finished")).toHaveLength(1);

    // Calls: main + sub + sub-after-refusal + main-final. A nested run would
    // have consumed one more script entry.
    expect(provider.calls).toHaveLength(4);

    // The refusal was fed back to the SUB model, not executed
    const [result] = toolResultsOf(provider, 2);
    expect(result.toolCallId).toBe("sd1");
    expect(result.isError).toBe(true);
    expect(result.output.error).toMatch(/not available to sub-agents/);
  });

  it("P9-3: a 4th delegation in one turn is refused with a delegation-limit error", async () => {
    const { provider, session } = makeSession([
      [
        ...delegateCall("a", "task a"),
        ...delegateCall("b", "task b"),
        ...delegateCall("c", "task c"),
        ...delegateCall("d", "task d"),
        { type: "turn_end", stopReason: "tool_use" },
      ],
      // only three subs ever run — in declared order
      subTurn("report a"),
      subTurn("report b"),
      subTurn("report c"),
      [
        { type: "text_delta", text: "summaries below" },
        { type: "turn_end", stopReason: "end_turn" },
      ],
    ]);
    const events = await collect(session.send("split the work four ways"));
    const types = events.map((e) => e.type);

    expect(types.filter((t) => t === "subagent_started")).toHaveLength(MAX_DELEGATIONS_PER_TURN);
    expect(types.filter((t) => t === "subagent_finished")).toHaveLength(MAX_DELEGATIONS_PER_TURN);
    expect(types[types.length - 1]).toBe("turn_complete");

    // Calls: main + 3 subs + main-final
    expect(provider.calls).toHaveLength(1 + MAX_DELEGATIONS_PER_TURN + 1);

    const results = toolResultsOf(provider, 4);
    expect(results.map((r) => r.toolCallId)).toEqual(["a", "b", "c", "d"]);
    expect(results[0].output).toEqual({ report: "report a" });
    expect(results[1].output).toEqual({ report: "report b" });
    expect(results[2].output).toEqual({ report: "report c" });
    expect(results[3].isError).toBe(true);
    expect(results[3].output.error).toMatch(/Delegation limit/);
  });

  it("P9-4: capReport truncates beyond the cap with a marker (pure)", () => {
    const exact = "x".repeat(SUB_AGENT_REPORT_MAX_CHARS);
    expect(capReport(exact)).toBe(exact);

    const capped = capReport("x".repeat(SUB_AGENT_REPORT_MAX_CHARS + 5));
    expect(capped.startsWith(exact)).toBe(true);
    expect(capped.endsWith("[report truncated]")).toBe(true);
    expect(capped).toHaveLength(SUB_AGENT_REPORT_MAX_CHARS + "\n[report truncated]".length);
  });

  it("P9-5: cancel() during a sub-run aborts the turn — cancelled, no subagent_finished", async () => {
    const { provider, session } = makeSession([
      [
        ...delegateCall("d1", "long investigation"),
        { type: "turn_end", stopReason: "tool_use" },
      ],
      // the sub's stream stalls until its AbortSignal fires
      (request) =>
        stalledStream(request.signal ?? new AbortController().signal, {
          type: "text_delta",
          text: "partial report",
        }),
    ]);
    const gen = session.send("go deep");
    const first = await gen.next();
    expect(first.value).toEqual({ type: "subagent_started", task: "long investigation" });

    // Start draining (this launches the sub-run, whose stream now stalls),
    // THEN cancel — the abort must propagate into the in-flight sub stream.
    const restPromise = collect(gen);
    await new Promise((r) => setTimeout(r, 10)); // let the sub stream start
    expect(provider.calls).toHaveLength(2); // main + stalled sub stream
    session.cancel();

    const rest = (await restPromise).map((e) => e.type);
    expect(rest).toContain("cancelled");
    expect(rest).not.toContain("subagent_finished");
    expect(rest).not.toContain("turn_complete");

    // the stalled sub stream IS the last provider call — it never completed
    expect(provider.calls).toHaveLength(2);
  });

  it("P9-6: subAgentTools() excludes delegate_task and nothing else (pure)", () => {
    expect(TOOL_DEFINITIONS.map((t) => t.name)).toContain("delegate_task");
    const sub = subAgentTools();
    expect(sub.map((t) => t.name)).not.toContain("delegate_task");
    expect(sub).toHaveLength(TOOL_DEFINITIONS.length - 1);
    expect(sub.map((t) => t.name)).toEqual(
      TOOL_DEFINITIONS.filter((t) => t.name !== "delegate_task").map((t) => t.name)
    );
  });
});
