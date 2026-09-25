import { describe, expect, it } from "vitest";
import { contextBreakdown, estimateTextTokens, nextCalibration } from "../scoring.js";
import type { ConversationMessage } from "../../../providers/types.js";

function user(text: string): ConversationMessage {
  return { role: "user", content: [{ type: "text", text }] };
}

describe("estimateTextTokens", () => {
  it("charges a wide-script character about a token, not a quarter", () => {
    // Same character count, very different real cost: ASCII runs ~4 chars per
    // token, while CJK/Kana/Hangul is closer to one token per character. A flat
    // chars/4 under-counts those histories ~4x and compaction fires far too late.
    const ascii = estimateTextTokens("a".repeat(40));
    const cjk = estimateTextTokens("日".repeat(40));
    expect(cjk).toBeGreaterThan(ascii);
  });

  it("is monotonic in length", () => {
    expect(estimateTextTokens("x".repeat(200))).toBeGreaterThan(estimateTextTokens("x".repeat(20)));
  });
});

describe("contextBreakdown token scale", () => {
  it("multiplies the reported budget by the session's learned calibration", () => {
    const messages = [user("a".repeat(400))];
    const plain = contextBreakdown(messages, 1000, 0.6);
    const scaled = contextBreakdown(messages, 1000, 0.6, 2);
    expect(plain.totalTokens).toBe(100);
    expect(scaled.totalTokens).toBe(200);
    expect(scaled.utilization).toBeCloseTo(plain.utilization * 2, 5);
    // The per-role breakdown must stay consistent with the scaled total.
    expect(scaled.byRole.user).toBe(200);
  });
});

describe("nextCalibration", () => {
  it("moves toward the measured/estimated ratio", () => {
    // Previous 1.0, measured twice the estimate → smoothed halfway to 2.0.
    expect(nextCalibration(1, 200, 100)).toBeCloseTo(1.5, 5);
  });

  it("clamps to the supported range", () => {
    expect(nextCalibration(1, 10_000, 100)).toBeLessThanOrEqual(2);
    expect(nextCalibration(1, 1, 10_000)).toBeGreaterThanOrEqual(0.5);
  });

  it("ignores a degenerate measurement instead of poisoning the factor", () => {
    expect(nextCalibration(1.2, 0, 100)).toBe(1.2);
    expect(nextCalibration(1.2, 100, 0)).toBe(1.2);
  });
});