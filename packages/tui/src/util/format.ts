import { getModel } from "@anvil/core";
import { PROVIDER_LABELS } from "./labels.js";

/**
 * Registry row for a model id, QUALIFIED by provider when known.
 *
 * AUDIT-02: nearly every model id is unique, but a few exist under two
 * providers with divergent metadata (`gpt-4o-mini` is PAID on `openai` and
 * FREE on `github`). Resolving by bare id let one screen say [PAID] while the
 * picker said FREE about the same model. Callers that know their provider MUST
 * pass it; omitting it keeps the old first-match behavior for free-form ids
 * (OpenRouter-style, which the registry cannot enumerate) — a documented
 * fallback, not an accident.
 */
export function modelInfo(modelId: string, providerId?: string) {
  return getModel(modelId, providerId);
}

/** Friendly display name for a model id; falls back to the raw id. */
export function displayModelLabel(modelId: string, providerId?: string): string {
  return modelInfo(modelId, providerId)?.displayName ?? modelId;
}

/** Friendly provider label for a provider id; falls back to the id. */
export function providerLabel(providerId: string): string {
  return PROVIDER_LABELS[providerId] ?? providerId;
}

/** Provider id for a model id (from the registry), if known. */
export function providerOfModel(modelId: string, providerId?: string): string | null {
  return modelInfo(modelId, providerId)?.providerId ?? null;
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

/**
 * Tool duration in the shortest honest unit: sub-second as `234ms`, a second or
 * more as `1.2s`. Returns "" when there is no measurement, so a caller renders
 * nothing rather than a fabricated `0ms`.
 */
export function formatDuration(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return "";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

/**
 * Compact token counts for cost annotations (Phase 28.10): 999 → "999",
 * 12,345 → "12.3k", 2,500,000 → "2.5M". Shared by the context gauge and the
 * per-turn cost line so both always agree about the same number.
 */
export function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${n}`;
}

/**
 * Certification badge. A "live" status is labeled by HOW it was earned: a real
 * probe renders " [✅ live]", the mock suite renders " [✅ mock]". An unrecorded
 * mode defaults to "mock" — the conservative label, since an absent mode is not
 * evidence of a live pass.
 */
export function formatCertificationBadge(
  certified: "live" | "broken" | "untested" | undefined,
  mode?: "mock" | "live"
): string {
  if (certified === "live") return mode === "live" ? " [✅ live]" : " [✅ mock]";
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
