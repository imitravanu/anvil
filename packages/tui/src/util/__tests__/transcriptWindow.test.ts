import { describe, expect, it } from "vitest";
import { estimatedLines, hiddenMessageCount } from "../transcriptWindow.js";
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
      msg("b".repeat(2000), "assistant"),
    ];
    expect(hiddenMessageCount(messages, 80, 20)).toBe(3);
    expect(hiddenMessageCount(messages, 80, 5000)).toBe(0);
  });
});
