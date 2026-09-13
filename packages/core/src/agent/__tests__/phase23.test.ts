import { describe, expect, it } from "vitest";
import { findCleanCompactionCut } from "../compaction.js";
import type { ConversationMessage } from "../../providers/types.js";
import { AgentSession } from "../session.js";
import { FakeProvider } from "./fakeProvider.js";
import { LEDGER_CAP } from "../ledger.js";

describe("Phase 23 Stability & Performance Suite", () => {
  describe("23.2 - Ledger Array Allocation Optimization", () => {
    it("bounds ledger length at LEDGER_CAP without dropping latest entries", () => {
      const provider = new FakeProvider([]);
      const session = new AgentSession(provider, {
        projectRoot: process.cwd(),
        systemPrompt: "test",
        maxTokens: 1000,
        model: "fake-model",
        permissionBroker: { requestPermission: async () => true },
      });

      const rec = (session as unknown as { recordLedger: (e: Record<string, unknown>) => void }).recordLedger.bind(session);
      for (let i = 0; i < LEDGER_CAP + 200; i++) {
        rec({
          eventType: "test_event",
          outcome: "ok",
          elapsedMs: 1,
        });
      }

      const stored = session.toStoredSession("fake", "fake-model");
      expect(stored.metadata.runLedger).toBeDefined();
      expect(stored.metadata.runLedger!.length).toBeLessThanOrEqual(LEDGER_CAP);
      expect(stored.metadata.runLedger![stored.metadata.runLedger!.length - 1].seq).toBe(LEDGER_CAP + 200);
    });
  });

  describe("23.3 - Compaction O(1) isSplit Check", () => {
    it("preserves tool call / tool result atomic intervals without split", () => {
      // Message 0: user
      // Message 1: assistant with tool_call "tc-1"
      // Message 2: user with tool_result "tc-1"
      // Message 3: assistant response
      // Message 4: user next question
      const history: ConversationMessage[] = [
        { role: "user", content: [{ type: "text", text: "query" }] },
        {
          role: "assistant",
          content: [{ type: "tool_call", call: { id: "tc-1", name: "read_file", input: {} } }],
        },
        {
          role: "user",
          content: [{ type: "tool_result", result: { toolCallId: "tc-1", content: "ok" } }],
        },
        { role: "assistant", content: [{ type: "text", text: "done" }] },
        { role: "user", content: [{ type: "text", text: "next" }] },
      ];

      // Cut 2 falls between tool_call (idx 1) and tool_result (idx 2)
      // findCleanCompactionCut should shift backwards to 1
      const cut = findCleanCompactionCut(history, 2);
      expect(cut).toBe(1);
    });

    it("returns targetCut directly when it does not split any interval", () => {
      const history: ConversationMessage[] = [
        { role: "user", content: [{ type: "text", text: "1" }] },
        { role: "assistant", content: [{ type: "text", text: "2" }] },
        { role: "user", content: [{ type: "text", text: "3" }] },
        { role: "assistant", content: [{ type: "text", text: "4" }] },
      ];
      expect(findCleanCompactionCut(history, 2)).toBe(2);
    });
  });
});
