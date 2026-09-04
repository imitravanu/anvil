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