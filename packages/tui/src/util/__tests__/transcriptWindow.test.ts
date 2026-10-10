import { describe, expect, it } from "vitest";
import { estimatedLines, hiddenMessageCount, applyTranscriptPin, clampTranscriptPin } from "../transcriptWindow.js";
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

  it("F5: measures terminal CELLS, so CJK turns are not under-estimated", () => {
    // 120 code points but 240 cells: counting code points estimated 2 rows
    // where the renderer takes 4, hiding messages the "… N earlier" line
    // never mentioned. 1 role + 4 text + 1 margin.
    expect(estimatedLines(msg("中文".repeat(60)), 80)).toBe(6);
    // Same fix on the non-markdown (streaming/user) path: 40 glyphs = 80 cells
    // → 2 rows (the code-point count said 1).
    expect(estimatedLines(msg("中".repeat(40), "user"), 80)).toBe(4);
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

// Takeover 2026-10-10: App's pin increments did not clamp, so a held PgUp
// drove STATE far past what the display clamp could show, and the next PgDn
// presses drained invisible surplus — scroll read as dead. The demonstration:
// 40 auto-repeats of +5 on a 12-message transcript put 200 in state while the
// screen clamped at 11; the first 38 PgDns changed nothing on screen. These
// tests pin the STATE contract App now uses at every pin mutation site.
describe("clampTranscriptPin (state-side pin ceiling)", () => {
  it("caps a held PgUp at the newest message instead of accumulating surplus", () => {
    let pin = 0;
    for (let i = 0; i < 40; i++) pin = clampTranscriptPin(pin + 5, 12);
    expect(pin).toBe(11);
    // The very next PgDn must move the window on screen — no invisible surplus.
    pin = Math.max(0, pin - 5);
    expect(pin).toBe(6);
  });

  it("never goes below follow, tolerates empty transcripts, and keeps small pins", () => {
    expect(clampTranscriptPin(-3, 12)).toBe(0);
    expect(clampTranscriptPin(4, 12)).toBe(4);
    expect(clampTranscriptPin(99, 0)).toBe(0);
    expect(clampTranscriptPin(99, 1)).toBe(0);
  });

  it("agrees with applyTranscriptPin's display clamp at every boundary", () => {
    for (const [pin, total] of [
      [0, 10],
      [9, 10],
      [10, 10],
      [250, 10],
      [7, 0],
    ] as const) {
      expect(clampTranscriptPin(pin, total)).toBe(applyTranscriptPin(total, 0, pin).pinned);
    }
  });
});
