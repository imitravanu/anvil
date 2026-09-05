import { afterEach, describe, expect, it } from "vitest";
import { AgentSession, type AgentEvent, type AgentOptions, type RestoreData } from "../index.js";
import { FakeProvider, type ScriptEntry } from "./fakeProvider.js";
import { registerModel, unregisterModels } from "../../providers/registry.js";
import type { ConversationMessage } from "../../providers/types.js";

// Tiny window so a chars/4 estimate crosses the compaction threshold without
// megabytes of fixture text. Registered per-test, removed after (phase-8 pattern).
const TINY_MODEL = "fake-tiny-context";

afterEach(() => unregisterModels([TINY_MODEL]));

function bigHistory(messages: number, charsPerMessage: number): ConversationMessage[] {
  return Array.from({ length: messages }, (_, i) => ({
    role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
    content: [{ type: "text" as const, text: "x".repeat(charsPerMessage) }],
  }));
}

function restoreWith(history: ConversationMessage[]): RestoreData {
  return {
    metadata: {
      id: "test-restore",
      title: "restore",
      providerId: "anthropic",
      model: TINY_MODEL,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    history,
  };
}

/**
 * Regression: a resumed session started with lastInputTokens = 0, so the
 * reactive compaction check never fired and the first send could exceed the
 * provider's context window and hard-fail. The constructor now seeds a
 * chars/4 estimate, letting compaction run BEFORE the first request.
 */
describe("proactive compaction on resume", () => {
  it("compacts an oversized restored history before the first real request", async () => {
    registerModel({
      id: TINY_MODEL,
      providerId: "anthropic",
      displayName: "Fake Tiny",
      contextWindow: 1000,
      supportsTools: true,
      supportsVision: false,
      isFree: false,
    });

    // 10 messages × 600 chars ≈ 1500 estimated tokens — above the 750-token
    // threshold of the 1000-token window; 6 most recent stay verbatim.
    const history = bigHistory(10, 600);
    // Script: [0] the summarizer call, [1] the real first turn.
    const provider = new FakeProvider([
      [
        { type: "text_delta", text: "Session summary." },
        { type: "turn_end", stopReason: "end_turn" },
      ],
      [
        { type: "text_delta", text: "Ready." },
        { type: "turn_end", stopReason: "end_turn" },
      ],
    ] as ScriptEntry[]);

    const broker: AgentOptions["permissionBroker"] = {
      async requestPermission() {
        return true;
      },
    };
    const session = new AgentSession(
      provider,
      {
        systemPrompt: "test",
        model: TINY_MODEL,
        maxTokens: 1024,
        projectRoot: "/tmp",
        permissionBroker: broker,
      },
      restoreWith(history)
    );

    const events: AgentEvent[] = [];
    for await (const e of session.send("continue the work")) events.push(e);

    // The FIRST provider call was the summarizer, not the user's turn —
    // compaction happened proactively, before any request with the full history.
    const summarizerCall = provider.calls[0];
    expect(summarizerCall.messages.length).toBeLessThan(history.length);

    const types = events.map((e) => e.type);
    expect(types).toContain("compacted");
    expect(types).toContain("turn_complete");

    // Compacted history: summary + the kept tail, well under the original 10.
    expect(session.getHistory().length).toBeLessThan(history.length + 2);
  });

  it("does NOT compact a small restored history (estimate below threshold)", async () => {
    registerModel({
      id: TINY_MODEL,
      providerId: "anthropic",
      displayName: "Fake Tiny",
      contextWindow: 1_000_000,
      supportsTools: true,
      supportsVision: false,
      isFree: false,
    });
    const provider = new FakeProvider([
      [
        { type: "text_delta", text: "Hello!" },
        { type: "turn_end", stopReason: "end_turn" },
      ],
    ] as ScriptEntry[]);
    const broker: AgentOptions["permissionBroker"] = {
      async requestPermission() {
        return true;
      },
    };
    const session = new AgentSession(
      provider,
      {
        systemPrompt: "test",
        model: TINY_MODEL,
        maxTokens: 1024,
        projectRoot: "/tmp",
        permissionBroker: broker,
      },
      restoreWith(bigHistory(4, 50))
    );

    const events: AgentEvent[] = [];
    for await (const e of session.send("hi")) events.push(e);
    expect(events.map((e) => e.type)).not.toContain("compacted");
    expect(events.map((e) => e.type)).toContain("turn_complete");
  });
});
