/**
 * DW-1.4 — Unicode design elements library.
 * Single source of box-drawing / status / meter glyphs so DW-2 components
 * share one visual language instead of hand-rolling characters.
 */
export const CHROME = {
  corners: { tl: "╭", tr: "╮", bl: "╰", br: "╯" },
  lines: { h: "─", v: "│", hBold: "━", vBold: "┃" },
  dots: { filled: "●", empty: "○", half: "◐" },
  arrows: { right: "▸", down: "▾", up: "▴", left: "◂" },
  status: { check: "✓", cross: "✗", spin: "⟳", warn: "⚠", info: "ℹ" },
  bars: { full: "█", three: "▓", two: "▒", one: "░", empty: " " },
  braille: { dot1: "⠁", dot12: "⠃", dot123: "⠇", dot1234: "⡇", full: "⣿", empty: "⠀" },
} as const;

/** Border styles Ink accepts (its own `BoxStyle` set, minus the internal ones). */
export type InkBorderStyle =
  | "single"
  | "double"
  | "round"
  | "bold"
  | "singleDouble"
  | "doubleSingle"
  | "classic";

/**
 * Map a theme's border token to Ink's `borderStyle`. The theme types are wider
 * than Ink's on purpose: `card: "none"` is the documented way for a theme to
 * say "no card frame", and Ink spells that `undefined` — the raw token is not
 * assignable, so this is the single translation point instead of a ternary
 * repeated in every card.
 */
export function inkBorderStyle(
  style: "round" | "single" | "double" | "bold" | "none"
): InkBorderStyle | undefined {
  return style === "none" ? undefined : style;
}

/**
 * Horizontal meter: `meter(0.6, 10)` → "██████░░░░".
 * Pure — powers gauges and progress lines without component code.
 */
export function meter(fraction: number, width: number): string {
  const clamped = Math.min(1, Math.max(0, fraction));
  const filled = Math.round(clamped * width);
  return CHROME.bars.full.repeat(filled) + CHROME.bars.one.repeat(Math.max(0, width - filled));
}

export type MeterStyle = "block" | "thin";

/**
 * Thin meter: `thinMeter(0.6, 10)` → "━━━━━━────".
 * Same fraction semantics as `meter`, but drawn from the bold/regular rules so
 * a theme can prefer a quiet gauge to a blocky one.
 */
export function thinMeter(fraction: number, width: number): string {
  const clamped = Math.min(1, Math.max(0, fraction));
  const filled = Math.round(clamped * width);
  return CHROME.lines.hBold.repeat(filled) + CHROME.lines.h.repeat(Math.max(0, width - filled));
}

/**
 * The meter a theme asked for. One dispatch point so every gauge in the UI
 * agrees — a component calling `meter` directly would silently ignore the
 * theme's choice.
 */
export function styledMeter(style: MeterStyle, fraction: number, width: number): string {
  return style === "thin" ? thinMeter(fraction, width) : meter(fraction, width);
}

/** Repeat a horizontal rule to a width: `rule(5)` → "─────". */
export function rule(width: number): string {
  return CHROME.lines.h.repeat(Math.max(0, width));
}

/**
 * Repeat a THEME's section divider to a width. Only the divider's first code
 * point is used: a custom theme may legitimately declare a multi-cell divider
 * ("=="), and repeating it whole would double the rule's width and overflow
 * the frame the rule was sized to. Empty/absent falls back to `─`.
 */
export function sectionRule(divider: string, width: number): string {
  const unit = [...divider][0] ?? CHROME.lines.h;
  return unit.repeat(Math.max(0, width));
}
