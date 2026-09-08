import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { COMPACTION_THRESHOLD, KEEP_RECENT_MESSAGES, compactIfNeeded, findCleanCompactionCut, mergeSummaryIntoHistory } from "../compaction.js";
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
