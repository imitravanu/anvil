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

/**
 * Pricing tag suffix: " [FREE]", " [PAID]", or "" when unknown. Single source
 * for the chrome in Header/StatusBar/pickers (was copy-pasted thrice).
 * pricingKind splits the DECISION from the rendering for styled call sites.
 */
export type PricingKind = "free" | "paid" | "unknown";
export function pricingKind(isFree: boolean | undefined): PricingKind {
  if (isFree === true) return "free";
  if (isFree === false) return "paid";
  return "unknown";
}
export function formatPricingTag(isFree: boolean | undefined): string {
  const kind = pricingKind(isFree);
  return kind === "free" ? " [FREE]" : kind === "paid" ? " [PAID]" : "";
}

/** Certification badge: " [✅ live]", " [❌ broken]", or " [⚠ untested]". */
export function formatCertificationBadge(
  certified: "live" | "broken" | "untested" | undefined
): string {
  if (certified === "live") return " [✅ live]";
  if (certified === "broken") return " [❌ broken]";
  if (certified === "untested") return " [⚠ untested]";
  return "";
}


/** Code-point-aware truncation ("…"). Never use String#length for this — CJK/emoji. */
export function curtail(text: string, max: number): string {
  if (max <= 0) return "";
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  if (max === 1) return "…";
  return chars.slice(0, max - 1).join("") + "…";
}

// Terminal cells, not code points: 🧪/🔧/🎯 are 2 cells wide, │ ⎌ ◈ are 1.
// Covers the wide ranges Anvil actually renders (emoji, CJK, fullwidth forms);
// anything unlisted counts 1, which only risks a wrap — never a crash.
const WIDE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x1100, 0x115f], // Hangul Jamo
  [0x2e80, 0x303e], // CJK radicals · punctuation
  [0x3041, 0x33ff], // Hiragana · Katakana · CJK compat
  [0x4e00, 0x9fff], // CJK unified
  [0xac00, 0xd7a3], // Hangul syllables
  [0xf900, 0xfaff], // CJK compatibility ideographs
  [0xfe10, 0xfe19], // vertical forms
  [0xfe30, 0xfe6f], // CJK compat forms
  [0xff00, 0xff60], // fullwidth forms
  [0xffe0, 0xffe6], // fullwidth signs
  [0x1f300, 0x1f64f], // emoji (🔧 🎯 …)
  [0x1f900, 0x1f9ff], // supplemental emoji (🧪 …)
];

function isWide(cp: number): boolean {
  return WIDE_RANGES.some(([lo, hi]) => cp >= lo && cp <= hi);
}

/** Rendered terminal-cell width of a string (wide chars count 2). */
export function displayWidth(text: string): number {
  let width = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp === 0xfe0f) continue; // variation selector adds no cell
    width += isWide(cp) ? 2 : 1;
  }
  return width;
}

/** Human-readable age of an ISO timestamp ("2m ago", "3h ago", "5d ago"). */
export function relativeTime(iso: string): string {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return iso;
  const diffMs = Date.now() - ts;
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * Collapse a (possibly multi-line) plan into at most `maxLines`
 * display lines that fit the terminal width. Pure — MissionDeck renders it.
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
/**
 * Context-window gauge for the status bar: "ctx 34%" from the provider's
 * latest measured input tokens. Warn color past 75% (where compaction kicks
 * in); hidden entirely when the model is unknown to the registry.
 */
export function contextGauge(
  inputTokens: number,
  contextWindow: number | undefined
): { text: string; fraction: number } | null {
  if (!contextWindow || contextWindow <= 0) return null;
  const fraction = Math.max(0, Math.min(1, inputTokens / contextWindow));
  return { text: `ctx ${Math.round(fraction * 100)}%`, fraction };
}

/**
 * Message timestamp for card headers ("14:02"). Manual fields — locale
 * APIs vary across machines and would make baselines flaky.
 */
export function formatTime(epochMs: number): string {
  const d = new Date(epochMs);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
