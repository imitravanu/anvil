import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { COMPACTION_THRESHOLD, KEEP_RECENT_MESSAGES, compactIfNeeded, findCleanCompactionCut, mergeSummaryIntoHistory, toSummarizerMessages } from "../compaction.js";
import { FakeProvider } from "./fakeProvider.js";
import type { ScriptEntry } from "./fakeProvider.js";
import { AgentSession } from "../index.js";
import { AUTO_APPROVE_BROKER } from "../types.js";
import { MODEL_REGISTRY } from "../../providers/registry.js";
import type { ConversationMessage } from "../../providers/types.js";
import type { StreamEvent } from "../../providers/types.js";

const model = "fake-model";

function textMsg(role: "user" | "assistant", text: string): ConversationMessage {
  return { role, content: [{ type: "text", text }] };
}

function makeHistory(n: number): ConversationMessage[] {
  return Array.from({ length: n }, (_, i) => textMsg(i % 2 === 0 ? "user" : "assistant", `msg ${i}`));
}

describe("compactIfNeeded", () => {
  it("below threshold: returns history unchanged with compacted: false", async () => {
    const history = makeHistory(10);
    const contextWindow = 1000;
    const { history: out, result } = await compactIfNeeded(
      history,
      contextWindow,
      contextWindow * COMPACTION_THRESHOLD - 1, // just below
      new FakeProvider([]), // must never be called
      model
    );
    expect(result.compacted).toBe(false);
    expect(out).toEqual(history);
  });

  it("above threshold with enough history: summary message prepended, recent messages kept verbatim", async () => {
    const provider = new FakeProvider([
      [
        { type: "text_delta", text: "Decisions: used tabs. Files: src/a.ts modified." },
        { type: "turn_end", stopReason: "end_turn" },
      ],
    ]);
    const history = makeHistory(10); // 10 > KEEP_RECENT_MESSAGES (6)
    const { history: out, result } = await compactIfNeeded(history, 1000, 990, provider, model);

    expect(result.compacted).toBe(true);
    expect(result.summary).toContain("Decisions");
    expect(out).toHaveLength(KEEP_RECENT_MESSAGES + 1);
    // Summary message is first and marked as such
    expect(out[0].role).toBe("user");
    expect((out[0].content[0] as any).text).toMatch(/^\[Earlier conversation summary, for context\]/);
    // The most recent messages are preserved verbatim, in order
    expect(out.slice(1)).toEqual(history.slice(history.length - KEEP_RECENT_MESSAGES));
    // The summarizer was called with only the older messages and no tools
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0].messages).toEqual(history.slice(0, history.length - KEEP_RECENT_MESSAGES));
    expect(provider.calls[0].tools).toEqual([]);
  });

  it("passes cancellation through to the summarization request", async () => {
    const provider = new FakeProvider([
      [
        { type: "text_delta", text: "Summary" },
        { type: "turn_end", stopReason: "end_turn" },
      ],
    ]);
    const controller = new AbortController();
    await compactIfNeeded(makeHistory(10), 1000, 990, provider, model, controller.signal);
    expect(provider.calls[0].signal).toBe(controller.signal);
  });

  it("above threshold but too little history to safely summarize: compacted: false", async () => {
    const provider = new FakeProvider([]); // must never be called
    const history = makeHistory(KEEP_RECENT_MESSAGES); // exactly the keep-limit
    const { history: out, result } = await compactIfNeeded(history, 1000, 990, provider, model);
    expect(result.compacted).toBe(false);
    expect(out).toEqual(history);
    expect(provider.calls).toHaveLength(0);
  });

  it("empty summary is a no-op, never a placeholder in history", async () => {
    const provider = new FakeProvider([
      [{ type: "turn_end", stopReason: "end_turn" }], // no text_delta at all
    ]);
    const { history: out, result } = await compactIfNeeded(makeHistory(10), 1000, 990, provider, model);
    expect(result.compacted).toBe(false);
    expect(out).toHaveLength(10);
  });

  it("rate limits or errors during compaction summarization gracefully bail out without throwing", async () => {
    const provider = new FakeProvider([
      [{ type: "error", message: "429 Rate limit exceeded" }],
    ]);
    const history = makeHistory(10);
    const { history: out, result } = await compactIfNeeded(history, 1000, 990, provider, model);
    expect(result.compacted).toBe(false);
    expect(out).toEqual(history);
  });

  it("uses custom summarizerModel when provided in options", async () => {
    const provider = new FakeProvider([
      [
        { type: "text_delta", text: "Summary text" },
        { type: "turn_end", stopReason: "end_turn" },
      ],
    ]);
    const history = makeHistory(10);
    await compactIfNeeded(history, 1000, 990, provider, model, undefined, {
      summarizerModel: "custom-summarizer-model",
    });
    expect(provider.calls[0].model).toBe("custom-summarizer-model");
  });

  it("findCleanCompactionCut shifts cut point to keep tool_call and tool_result together", () => {
    const history: ConversationMessage[] = [
      textMsg("user", "start"),
      {
        role: "assistant",
        content: [{ type: "tool_call", call: { id: "call_1", name: "read_file", input: {} } }],
      },
      {
        role: "user",
        content: [{ type: "tool_result", result: { toolCallId: "call_1", content: "file data" } }],
      },
      textMsg("assistant", "done"),
    ];
    // If targetCut is 2 (between call_1 at 1 and result_1 at 2), it would split them.
    // It should retreat cut to 1 so that both call_1 and result_1 remain together in recent.
    const cut = findCleanCompactionCut(history, 2);
    expect(cut).toBe(1);
  });
});

describe("mergeSummaryIntoHistory", () => {
  const summary = textMsg("user", "[Earlier summary]");
  it("merges when the kept tail starts with a user message", () => {
    const out = mergeSummaryIntoHistory([summary, textMsg("user", "tail"), textMsg("assistant", "reply")]);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      role: "user",
      content: [{ type: "text", text: "[Earlier summary]" }, { type: "text", text: "tail" }],
    });
    expect(out[1].role).toBe("assistant");
  });

  it("leaves alternating histories untouched", () => {
    const history = [summary, textMsg("assistant", "a"), textMsg("user", "u")];
    expect(mergeSummaryIntoHistory(history)).toBe(history); // same reference, no copy
  });

  it("handles degenerate inputs without throwing", () => {
    expect(mergeSummaryIntoHistory([])).toEqual([]);
    expect(mergeSummaryIntoHistory([summary])).toEqual([summary]);
  });
});

describe("compaction in the agent loop", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-comp-"));
  });
  afterEach(() => {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  const modelId = "gemini-3.6-flash";
  const window = MODEL_REGISTRY.find((m) => m.id === modelId)!.contextWindow;

  function bigReadTurn(file: string, id: string): StreamEvent[] {
    return [
      { type: "tool_call_end", id, name: "read_file", input: { path: file } },
      { type: "usage", inputTokens: window, outputTokens: 10 },
      { type: "turn_end", stopReason: "tool_use" },
    ];
  }

  function textTurn(): StreamEvent[] {
    return [
      { type: "text_delta", text: "Done." },
      { type: "usage", inputTokens: window, outputTokens: 10 },
      { type: "turn_end", stopReason: "end_turn" },
    ];
  }

  it("compacts at most once per turn and never leaves consecutive users", async () => {
    const file = path.join(tmp, "a.txt");
    fs.writeFileSync(file, "x");
    const script: StreamEvent[][] = [
      // send 1: build a long history with small usage (no compaction: model
      // lookup uses lastInputTokens, which stays under threshold throughout).
      ...[0, 1, 2].map((i) => [
        { type: "tool_call_end", id: `s${i}`, name: "read_file", input: { path: file } },
        { type: "usage", inputTokens: 100, outputTokens: 10 },
        { type: "turn_end", stopReason: "tool_use" },
      ] as StreamEvent[]),
      [{ type: "text_delta", text: "ok" }, { type: "usage", inputTokens: 100, outputTokens: 10 }, { type: "turn_end", stopReason: "end_turn" }],
      // send 2: huge usage every round. The loop-top check runs BEFORE each
      // stream, so the summarizer entry sits between tool streams: after the
      // first huge-usage round lands, the next loop-top compacts.
      bigReadTurn(file, "b0"),
      // the single summarizer call (tools: [] distinguishes it from turns)
      [{ type: "text_delta", text: "Earlier: three reads." }, { type: "turn_end", stopReason: "end_turn" }],
      bigReadTurn(file, "b1"),
      bigReadTurn(file, "b2"),
      textTurn(),
    ];
    const provider = new FakeProvider(script);
    const session = new AgentSession(provider, {
      systemPrompt: "",
      model: modelId,
      maxTokens: 512,
      projectRoot: tmp,
      permissionBroker: AUTO_APPROVE_BROKER,
    });
    const drain = async (text: string) => {
      const events = [];
      for await (const e of session.send(text)) events.push(e);
      return events;
    };
    await drain("first");
    const events = await drain("second");
    expect(events.filter((e) => e.type === "compacted")).toHaveLength(1);
    const summarizes = provider.calls.filter((c) => c.tools.length === 0);
    expect(summarizes).toHaveLength(1);
    // History role alternation holds after the merge.
    const history = session.getHistory();
    for (let i = 1; i < history.length; i++) {
      expect(`${history[i - 1].role}/${history[i].role}`).not.toBe("user/user");
    }
  });

  it("a throwing summarizer never kills the turn", async () => {
    const file = path.join(tmp, "a.txt");
    fs.writeFileSync(file, "x");
    const script: ScriptEntry[] = [
      ...[0, 1, 2].map((i) => [
        { type: "tool_call_end", id: `s${i}`, name: "read_file", input: { path: file } },
        { type: "usage", inputTokens: 100, outputTokens: 10 },
        { type: "turn_end", stopReason: "tool_use" },
      ] as StreamEvent[]),
      [{ type: "text_delta", text: "ok" }, { type: "usage", inputTokens: 100, outputTokens: 10 }, { type: "turn_end", stopReason: "end_turn" }],
      bigReadTurn(file, "b0"),
      // summarizer entry: a stream that throws instead of summarizing
      async function* () {
        throw new Error("summarizer down");
      },
      textTurn(),
    ];
    const provider = new FakeProvider(script);
    const session = new AgentSession(provider, {
      systemPrompt: "",
      model: modelId,
      maxTokens: 512,
      projectRoot: tmp,
      permissionBroker: AUTO_APPROVE_BROKER,
    });
    const drain = async (text: string) => {
      const events = [];
      for await (const e of session.send(text)) events.push(e);
      return events;
    };
    await drain("first");
    const events = await drain("second");
    expect(events.some((e) => e.type === "turn_complete")).toBe(true);
    expect(events.some((e) => e.type === "compacted")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// S2.3 — Compaction realism. `compactIfNeeded` rewrites the array the providers
// replay, so the invariants below are not cosmetic: a provider rejects a history
// with two consecutive same-role messages, and a tool_result whose tool_call was
// summarized away (or a tool_call left unanswered) is a malformed payload.
// Deterministic PRNG: a failing shape reproduces exactly, so this cannot flake.
// ---------------------------------------------------------------------------

/** Linear congruential generator — seeded, reproducible, no dependency. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/** A VALID history: alternating roles, every tool pair intact and adjacent. */
function generatedHistory(rand: () => number, turns: number): ConversationMessage[] {
  const out: ConversationMessage[] = [];
  for (let t = 0; t < turns; t++) {
    out.push(textMsg("user", `request ${t} about the parser`));
    // Mirror the agent loop: it keeps calling the model while responses carry
    // tool calls, and a response with none ENDS the turn. So an assistant
    // message is never adjacent to another, and tool results are always
    // followed by the assistant that consumed them.
    for (let s = 0; s < 4; s++) {
      const calls = Math.floor(rand() * 3); // 0..2 calls
      if (calls === 0) {
        out.push(textMsg("assistant", `answer ${t}.${s} about the parser`));
        break;
      }
      const assistantContent: ConversationMessage["content"] = [
        { type: "text", text: `working ${t}.${s}` },
      ];
      for (let c = 0; c < calls; c++) {
        assistantContent.push({
          type: "tool_call",
          call: { id: `call_${t}_${s}_${c}`, name: "read_file", input: { path: "src/parser.ts" } },
        });
      }
      out.push({ role: "assistant", content: assistantContent });
      const results: ConversationMessage["content"] = [];
      for (let c = 0; c < calls; c++) {
        results.push({
          type: "tool_result",
          result: { toolCallId: `call_${t}_${s}_${c}`, content: `parser output ${t} ${s} ${c}` },
        });
      }
      if (rand() < 0.5) results.push({ type: "text", text: `notes for ${t}.${s}` });
      out.push({ role: "user", content: results });
    }
    // The loop can run out of steps with results still last; the real session
    // closes that with an assistant budget notice, so do the same here.
    if (out[out.length - 1].role === "user") {
      out.push(textMsg("assistant", `done with ${t}`));
    }
  }
  return out;
}

/** Assert the shape every provider must accept. Names the offending index. */
function expectProviderShape(history: ConversationMessage[], label: string): void {
  for (let i = 1; i < history.length; i++) {
    expect(
      history[i].role,
      `${label}: consecutive ${history[i].role} at index ${i - 1}/${i}`
    ).not.toBe(history[i - 1].role);
  }
  // Forward: a result must have its call earlier. Backward: a call must have its
  // result later. Together these forbid orphans in both directions.
  const callsSeen = new Set<string>();
  history.forEach((m, i) => {
    for (const c of m.content) {
      if (c.type === "tool_call") callsSeen.add(c.call.id);
      if (c.type === "tool_result") {
        expect(
          callsSeen.has(c.result.toolCallId),
          `${label}: orphan tool_result for ${c.result.toolCallId} at index ${i}`
        ).toBe(true);
      }
    }
  });
  const resultsSeen = new Set<string>();
  for (let i = history.length - 1; i >= 0; i--) {
    for (const c of history[i].content) {
      if (c.type === "tool_result") resultsSeen.add(c.result.toolCallId);
      if (c.type === "tool_call") {
        expect(
          resultsSeen.has(c.call.id),
          `${label}: unanswered tool_call ${c.call.id} at index ${i}`
        ).toBe(true);
      }
    }
  }
}

function summaryProvider(): FakeProvider {
  return new FakeProvider([
    [
      { type: "text_delta", text: "Decisions: kept the parser." },
      { type: "turn_end", stopReason: "end_turn" },
    ],
  ]);
}

describe("S2.3: compaction preserves the provider shape (seeded property test)", () => {
  it("holds for every generated history, with and without a task", async () => {
    let compactedRuns = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const rand = rng(seed);
      const history = generatedHistory(rand, 6 + Math.floor(rand() * 6));
      // The generator must produce valid input, or this would measure the
      // fixture instead of the compactor.
      expectProviderShape(history, `seed ${seed} input`);

      for (const options of [undefined, { task: "parser" }]) {
        const { history: out, result } = await compactIfNeeded(
          history,
          1000,
          990,
          summaryProvider(),
          model,
          undefined,
          options
        );
        if (!result.compacted) continue;
        compactedRuns += 1;
        // The session routes this through HistoryStore.applyCompacted, which is
        // this merge — assert on what a provider would actually receive.
        const merged = mergeSummaryIntoHistory(out);
        expectProviderShape(merged, `seed ${seed} options=${JSON.stringify(options)}`);
        expect(merged.length).toBeLessThan(history.length);
      }
    }
    // A property test that stops compacting still passes — and proves nothing.
    expect(compactedRuns).toBeGreaterThan(20);
  });

  it("holds when selective keep picks messages out of the summarized region", async () => {
    // A real keep budget, so selectiveKeep can afford several NON-adjacent
    // messages: the regime where kept and dropped messages interleave.
    let compactedRuns = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const rand = rng(seed);
      const history = generatedHistory(rand, 8 + Math.floor(rand() * 6));
      expectProviderShape(history, `seed ${seed} input`);

      const { history: out, result } = await compactIfNeeded(
        history,
        4000,
        3200, // above the 0.75 threshold, leaving keep budget
        summaryProvider(),
        model,
        undefined,
        { task: "parser" }
      );
      if (!result.compacted) continue;
      compactedRuns += 1;
      expectProviderShape(mergeSummaryIntoHistory(out), `seed ${seed} selective`);
    }
    // Same guard as above: the selective path must actually be exercised.
    expect(compactedRuns).toBeGreaterThan(20);
  });
});

describe("S2.3: the enormous-message boundary the README states", () => {
  it("refuses rather than mangling when everything is inside the keep window", async () => {
    // Few messages, each enormous: no older region exists to summarize, so the
    // honest answer is a no-op — what the README tells the user to expect.
    const huge = "x".repeat(200_000);
    const history: ConversationMessage[] = [
      textMsg("user", huge),
      textMsg("assistant", huge),
      textMsg("user", huge),
      textMsg("assistant", huge),
    ];
    const provider = new FakeProvider([]); // must never be called
    const { history: out, result } = await compactIfNeeded(
      history,
      1000,
      999_999, // hopelessly over the window
      provider,
      model
    );
    expect(result.compacted).toBe(false);
    expect(out).toEqual(history);
    expect(provider.calls).toHaveLength(0);
  });
});

describe("toSummarizerMessages", () => {
  it("keeps text, marks tool calls, drops successful results, keeps short errors", () => {
    const msgs: ConversationMessage[] = [
      { role: "user", content: [{ type: "text", text: "fix the bug" }] },
      {
        role: "assistant",
        content: [{ type: "tool_call", call: { id: "c1", name: "read_file", input: { path: "a.ts" } } }],
      },
      {
        role: "user",
        content: [
          { type: "tool_result", result: { toolCallId: "c1", content: JSON.stringify({ data: "x".repeat(5000) }) } },
          { type: "tool_result", result: { toolCallId: "c2", content: "disk full", isError: true } },
        ],
      },
      { role: "assistant", content: [{ type: "text", text: "done" }] },
    ];
    const out = toSummarizerMessages(msgs);
    const flat = out.map((m) => m.content.map((c) => (c.type === "text" ? c.text : "?")).join("|")).join("\n");
    expect(flat).toContain("fix the bug");
    expect(flat).toContain("[tool call: read_file]");
    expect(flat).not.toContain("x".repeat(100));
    expect(flat).toContain("[tool error: disk full]");
    expect(flat).toContain("done");
  });

  it("drops messages left with no text content", () => {
    const msgs: ConversationMessage[] = [
      {
        role: "user",
        content: [{ type: "tool_result", result: { toolCallId: "c1", content: "{}" } }],
      },
    ];
    expect(toSummarizerMessages(msgs)).toEqual([]);
  });
});
