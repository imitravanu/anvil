import { MODEL_REGISTRY } from "@anvil/core";
import { PROVIDER_LABELS } from "./labels.js";

/** Friendly display name for a model id; falls back to the raw id. */
export function displayModelLabel(modelId: string): string {
  const info = MODEL_REGISTRY.find((m) => m.id === modelId);
  return info?.displayName ?? modelId;
}

/** Friendly provider label for a provider id; falls back to the id. */
export function providerLabel(providerId: string): string {
  return PROVIDER_LABELS[providerId] ?? providerId;
}

/** Provider id for a model id (from the registry), if known. */
export function providerOfModel(modelId: string): string | null {
  return MODEL_REGISTRY.find((m) => m.id === modelId)?.providerId ?? null;
}

/** Code-point-aware truncation ("…"). Never use String#length for this — CJK/emoji. */
export function curtail(text: string, max: number): string {
  if (max <= 0) return "";
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  if (max === 1) return "…";
  return chars.slice(0, max - 1).join("") + "…";
}

/**
 * Phase 8.5 (U1): collapse a (possibly multi-line) plan into at most `maxLines`
 * display lines that fit the terminal width. Pure — PlanLine just renders it.
 */
export function collapsePlan(
  plan: string,
  width: number,
  maxLines = 2
): { lines: string[]; hidden: number } {
  const avail = Math.max(20, width - 12); // budget for the "plan ▸" label + padding
  const all = plan
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() !== "");
  if (all.length === 0) return { lines: [], hidden: 0 };
  const lines = all.slice(0, maxLines).map((l) => curtail(l, avail));
  return { lines, hidden: Math.max(0, all.length - maxLines) };
}