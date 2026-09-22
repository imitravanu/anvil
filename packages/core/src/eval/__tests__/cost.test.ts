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
