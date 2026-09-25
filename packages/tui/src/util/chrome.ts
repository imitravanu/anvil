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

export type ChromeGroup = keyof typeof CHROME;

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
