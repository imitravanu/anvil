import { describe, expect, it } from "vitest";
import { estimateCostUsd, formatCost, pricingForModel } from "../cost.js";
import { createEvalReport, formatEvalReport } from "../report.js";
import { registerModel, unregisterModels } from "../../providers/registry.js";
import type { EvalResult } from "../types.js";
import type { ModelInfo } from "../../providers/types.js";

const base = { contextWindow: 1_000, supportsTools: true, supportsVision: false } as const;

function model(over: Partial<ModelInfo>): ModelInfo {
  return { ...base, id: "x", providerId: "p", displayName: "X", ...over };
}

function result(taskId: string, input: number, output: number): EvalResult {
  return {
    taskId,
    name: taskId,
    category: "bugfix",
    passed: true,
    turns: 1,
    wallClockMs: 1,
    tokensUsed: { input, output },
    toolCalls: 1,
  };
}

describe("pricingForModel (27.5)", () => {
  it("prefers explicit per-1k pricing", () => {
    expect(pricingForModel(model({ isFree: true, costPer1kInputTokens: 3, costPer1kOutputTokens: 9 }))).toEqual({
      inputPer1k: 3,
      outputPer1k: 9,
    });
  });

  it("prices a free model at $0 without explicit fields", () => {
    expect(pricingForModel(model({ isFree: true }))).toEqual({ inputPer1k: 0, outputPer1k: 0 });
  });

  it("returns null for an unpriced paid model — unknown, never $0", () => {
    expect(pricingForModel(model({ isFree: false }))).toBeNull();
  });

  it("returns null for a missing model", () => {
    expect(pricingForModel(undefined)).toBeNull();
  });
});

describe("estimateCostUsd", () => {
  it("applies (in*Pin + out*Pout)/1000", () => {
    expect(estimateCostUsd({ input: 1_000, output: 500 }, { inputPer1k: 2, outputPer1k: 8 })).toBe(6);
  });

  it("is undefined when pricing is unknown", () => {
    expect(estimateCostUsd({ input: 1_000, output: 500 }, null)).toBeUndefined();
  });

  it("is 0 for zero usage on a known price", () => {
    expect(estimateCostUsd({ input: 0, output: 0 }, { inputPer1k: 2, outputPer1k: 8 })).toBe(0);
  });
});

describe("formatCost", () => {
  it("formats a known total", () => {
    expect(formatCost(6, 0)).toBe("$6.0000");
  });

  it("names the unpriced count instead of printing a partial total", () => {
    expect(formatCost(undefined, 3)).toBe("n/a (3 unpriced)");
  });

  it("is a bare n/a when there is nothing to price", () => {
    expect(formatCost(undefined, 0)).toBe("n/a");
  });
});

describe("createEvalReport cost estimation (27.5)", () => {
  it("prices a free model's run at exactly $0", () => {
    const rep = createEvalReport([result("t1", 1_000, 500)], "llama-3.3-70b-versatile", "groq");
    expect(rep.estimatedCostUsd).toBe(0);
    expect(rep.unpricedTasks).toBe(0);
    expect(rep.results[0].estimatedCostUsd).toBe(0);
  });

  it("leaves an unpriced paid model's run undefined (no fake $0)", () => {
    const rep = createEvalReport([result("t1", 1_000, 500)], "claude-sonnet-5", "anthropic");
    expect(rep.estimatedCostUsd).toBeUndefined();
    expect(rep.unpricedTasks).toBe(1);
    expect(rep.results[0].estimatedCostUsd).toBeUndefined();
  });

  it("computes and aggregates an explicit price", () => {
    const id = "phase27-priced-probe";
    registerModel(
      model({
        id,
        providerId: "openai",
        displayName: "Priced Probe",
        isFree: false,
        costPer1kInputTokens: 2,
        costPer1kOutputTokens: 8,
      })
    );
    try {
      const rep = createEvalReport([result("t1", 1_000, 500), result("t2", 1_000, 0)], id, "openai");
      // t1 = (1000*2 + 500*8)/1000 = 6 ; t2 = (1000*2)/1000 = 2 ; total 8
      expect(rep.results[0].estimatedCostUsd).toBe(6);
      expect(rep.results[1].estimatedCostUsd).toBe(2);
      expect(rep.estimatedCostUsd).toBe(8);
      expect(rep.unpricedTasks).toBe(0);
    } finally {
      unregisterModels([id]);
    }
  });

  it("displays total and per-task cost in the formatted report", () => {
    const rep = createEvalReport([result("t1", 1_000, 500)], "llama-3.3-70b-versatile", "groq");
    const text = formatEvalReport(rep);
    expect(text).toContain("Total Cost: $0.0000");
    expect(text).toContain("Cost");
  });
});

describe("cached-input accounting (audit follow-up, 2026-10-05)", () => {
  it("bills cached input at the DECLARED cache-read price", () => {
    const anthropicish = { inputPer1k: 3, outputPer1k: 15, cachedInputPer1k: 0.3 };
    // fresh 1,000×3 + cached 9,000×0.3 + out 1,000×15 = 3 + 2.7 + 15 = 20.7
    expect(
      estimateCostUsd({ input: 10_000, output: 1_000, cachedInput: 9_000 }, anthropicish)
    ).toBeCloseTo(20.7, 6);
  });

  it("keeps the full-rate upper bound when NO cache price is declared", () => {
    // No invented discount — an unknown cache price bills at the input rate,
    // and the report says the figure is an upper bound (next test).
    expect(
      estimateCostUsd(
        { input: 10_000, output: 1_000, cachedInput: 9_000 },
        { inputPer1k: 3, outputPer1k: 15 }
      )
    ).toBeCloseTo(45, 6);
  });

  it("clamps a mis-reported cached count so the cost can never go negative", () => {
    expect(
      estimateCostUsd({ input: 100, output: 0, cachedInput: 500 }, { inputPer1k: 3, outputPer1k: 15 })
    ).toBeCloseTo(0.3, 6);
  });

  it("carries a declared cache-read price through pricingForModel", () => {
    expect(
      pricingForModel(
        model({ costPer1kInputTokens: 3, costPer1kOutputTokens: 15, costPer1kCachedInputTokens: 0.3 })
      )
    ).toEqual({ inputPer1k: 3, outputPer1k: 15, cachedInputPer1k: 0.3 });
    // Absent means unknown — the pricing object must not invent the key.
    expect(pricingForModel(model({ costPer1kInputTokens: 3, costPer1kOutputTokens: 15 }))).toEqual({
      inputPer1k: 3,
      outputPer1k: 15,
    });
  });

  it("reports the cached share and flags an undeclared-discount total as an upper bound", () => {
    const id = "phase38-cached-probe";
    registerModel(
      model({
        id,
        providerId: "openai",
        displayName: "Cache Probe",
        isFree: false,
        costPer1kInputTokens: 2,
        costPer1kOutputTokens: 8,
        // deliberately NO costPer1kCachedInputTokens → cache reads unpriced
      })
    );
    try {
      const r = result("t1", 10_000, 500);
      r.tokensUsed = { input: 10_000, output: 500, cachedInput: 8_000 };
      const rep = createEvalReport([r], id, "openai");
      expect(rep.totalTokens).toEqual({ input: 10_000, output: 500, cachedInput: 8_000 });
      // 8,000 of the 10,000 input was a cache read, billed at the full rate:
      // (10,000×2 + 500×8)/1000 = 24 — an UPPER BOUND, and it must say so.
      expect(rep.estimatedCostUsd).toBeCloseTo(24, 6);
      expect(rep.costUpperBound).toBe(true);
      const text = formatEvalReport(rep);
      expect(text).toContain("8,000 cached");
      expect(text).toContain("upper bound");
    } finally {
      unregisterModels([id]);
    }
  });
});
