import { describe, expect, it } from "vitest";
import { COMPACTION_THRESHOLD, KEEP_RECENT_MESSAGES, compactIfNeeded } from "../compaction.js";
import { FakeProvider } from "./fakeProvider.js";
import type { ConversationMessage } from "../../providers/types.js";

const model = "fake-model";

function textMsg(role: "user" | "assistant", text: string): ConversationMessage {
  return { role, content: [{ type: "text", text }] };
}

function makeHistory(n: number): ConversationMessage[] {
  return Array.from({ length: n }, (_, i) => textMsg(i % 2 === 0 ? "user" : "assistant", `msg ${i}`));
}

const summarizer = new FakeProvider([
  [
    { type: "text_delta", text: "Summary of earlier turns." },
    { type: "turn_end", stopReason: "end_turn" },
  ],
]);
void summarizer;

describe("compactIfNeeded", () => {
  it("below threshold: returns history unchanged with compacted: false", async () => {
    const history = makeHistory(10);
    const contextWindow = 1000;
    const { history: out, result } = await compactIfNeeded(
      history,
      contextWindow,
      contextWindow * COMPACTION_THRESHOLD - 1, // just below
      summarizer,
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

  it("above threshold but too little history to safely summarize: compacted: false", async () => {
    const provider = new FakeProvider([]); // must never be called
    const history = makeHistory(KEEP_RECENT_MESSAGES); // exactly the keep-limit
    const { history: out, result } = await compactIfNeeded(history, 1000, 990, provider, model);
    expect(result.compacted).toBe(false);
    expect(out).toEqual(history);
    expect(provider.calls).toHaveLength(0);
  });
});