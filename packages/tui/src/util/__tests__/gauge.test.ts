import { describe, expect, it } from "vitest";
import { contextGauge } from "../format.js";

describe("contextGauge", () => {
  it("returns null for unknown models (no context window)", () => {
    expect(contextGauge(500, undefined)).toBeNull();
    expect(contextGauge(500, 0)).toBeNull();
  });

  it("renders the measured fraction", () => {
    expect(contextGauge(340_000, 1_000_000)).toEqual({ text: "ctx 34%", fraction: 0.34 });
    expect(contextGauge(0, 1_000_000)).toEqual({ text: "ctx 0%", fraction: 0 });
  });

  it("clamps out-of-range usage instead of lying", () => {
    expect(contextGauge(2_000_000, 1_000_000)?.fraction).toBe(1);
    expect(contextGauge(-5, 1_000_000)?.fraction).toBe(0);
  });
});
