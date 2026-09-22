import type { ModelInfo } from "../providers/types.js";

/**
 * Phase 27.5 — dollar cost estimation for eval runs.
 *
 * Honest sourcing is the whole point: most ids in the registry are
 * forward-looking, so a price is often unknown. Unknown is represented as
 * `null`/`undefined` and must be rendered as unavailable — NEVER as $0, which
 * would make a paid run look free. Free models are the one case we can price
 * exactly ($0, by definition of `isFree`).
 */

export interface ModelPricing {
  /** USD per 1,000 input tokens. */
  inputPer1k: number;
  /** USD per 1,000 output tokens. */
  outputPer1k: number;
}

/**
 * Resolve a model's pricing, or null when it cannot be known.
 * Priority: explicit `costPer1k*` fields → free model ($0) → unknown (null).
 */
export function pricingForModel(model: ModelInfo | undefined): ModelPricing | null {
  if (!model) return null;
  const { costPer1kInputTokens: inputPer1k, costPer1kOutputTokens: outputPer1k } = model;
  if (typeof inputPer1k === "number" && typeof outputPer1k === "number") {
    return { inputPer1k, outputPer1k };
  }
  if (model.isFree) return { inputPer1k: 0, outputPer1k: 0 };
  return null;
}

/** USD cost for a usage, or undefined when pricing is unknown. */
export function estimateCostUsd(
  usage: { input: number; output: number },
  pricing: ModelPricing | null
): number | undefined {
  if (!pricing) return undefined;
  return (usage.input * pricing.inputPer1k + usage.output * pricing.outputPer1k) / 1000;
}

/**
 * Human-readable cost cell. `unpricedCount > 0` means the total is NOT a
 * total — say so rather than printing a partial sum as if it were complete.
 */
export function formatCost(estimatedCostUsd: number | undefined, unpricedCount: number): string {
  if (estimatedCostUsd !== undefined) return `$${estimatedCostUsd.toFixed(4)}`;
  if (unpricedCount > 0) return `n/a (${unpricedCount} unpriced)`;
  return "n/a";
}
