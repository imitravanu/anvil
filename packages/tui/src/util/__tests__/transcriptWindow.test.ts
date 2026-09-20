import { describe, expect, it } from "vitest";
import { estimatedLines, hiddenMessageCount, applyTranscriptPin } from "../transcriptWindow.js";
import type { DisplayMessage } from "../../hooks/useAgentController.js";

function msg(text: string, role: DisplayMessage["role"] = "assistant", toolCalls = 0): DisplayMessage {
  return {
    id: Math.random().toString(36).slice(2),
    role,
    text,
    streaming: false,
    toolCalls: Array.from({ length: toolCalls }, (_, i) => ({
      id: `t${i}`,
      name: "read_file",
      input: {},
      status: "done" as const,
    })),
    subAgents: [],
  };
}

describe("transcript window estimator", () => {
  it("counts role line, wrapped text, tool cards, and margin", () => {
    const m = msg("hello", "assistant", 2);
    expect(estimatedLines(m, 80)).toBe(1 + 1 + 2 + 1);
  });

  it("wraps long text across multiple estimated lines", () => {
    const m = msg("x".repeat(600));
    expect(estimatedLines(m, 80)).toBeGreaterThan(3);
  });

  it("counts oldest messages as hidden only when they cannot fit", () => {
    const messages = [
      msg("a".repeat(2000), "user"), // huge — will not fit a 20-row budget
      msg("short", "assistant"),
      msg("b".repeat(2000), "assistant"), // newest huge reply
    ];
    // The newest message is bottom-anchored, so its tail stays visible and it
    // is never counted as hidden — only the two messages above it are.
    expect(hiddenMessageCount(messages, 80, 20)).toBe(2);
    expect(hiddenMessageCount(messages, 80, 5000)).toBe(0);
  });

  it("never counts a short exchange as hidden just because the newest answer is tall", () => {
    // One exchange: user prompt + a reply taller than the whole 20-row
    // transcript (est ~23 rows). The reply is on screen (bottom-anchored, tail
    // visible), so the only hidden message is the user's own prompt.
    const messages = [
      msg("what does the module export?", "user"),
      msg("y".repeat(1500)), // est ~23 rows at width 80
    ];
    expect(hiddenMessageCount(messages, 80, 20)).toBe(1);
  });

  it("counts messages fully above the fold when the budget is exactly consumed", () => {
    // Three 10-row messages, budget exactly 20: the two bottom messages end
    // precisely at the fold top, so the oldest is fully hidden.
    const ten = "x".repeat(600); // est ~10 rows at width 80
    const messages = [msg(ten, "user"), msg(ten), msg(ten)];
    expect(hiddenMessageCount(messages, 80, 21)).toBe(1);
  });
});

describe("transcript pin window", () => {
  it("follows live when nothing is pinned", () => {
    expect(applyTranscriptPin(4, 1, 0)).toEqual({ start: 1, end: 4, pinned: 0 });
  });

  it("holds back newest messages and keeps at least one visible", () => {
    expect(applyTranscriptPin(4, 0, 2)).toEqual({ start: 0, end: 2, pinned: 2 });
    expect(applyTranscriptPin(1, 0, 9)).toEqual({ start: 0, end: 1, pinned: 0 });
    expect(applyTranscriptPin(0, 0, 5)).toEqual({ start: 0, end: 0, pinned: 0 });
  });

  it("never starts past the pinned end", () => {
    expect(applyTranscriptPin(5, 4, 4)).toEqual({ start: 0, end: 1, pinned: 4 });
  });
});
