/**
 * DW-4.3 — braille micro-charts. Dense series visualization in a handful of
 * cells (token growth, effort). Pure and unit-tested; blank for empty input.
 */

// 8 levels, 1 cell each (bottom-aligned block heights 0..7 within a braille cell pair).
const LEVELS = ["⠀", "⡀", "⡄", "⡆", "⡇", "⡏", "⡟", "⡿"];

/**
 * Sparkline over values, normalized to min..max. Flat series render mid-level
 * (never a misleading slope); single values render one mid cell.
 */
export function brailleSparkline(values: readonly number[], width = 8): string {
  if (values.length === 0 || width <= 0) return "";
  const take = values.slice(-Math.max(1, width));
  const min = Math.min(...take);
  const max = Math.max(...take);
  if (max === min) return LEVELS[3].repeat(take.length);
  return take
    .map((v) => {
      const level = Math.round(((v - min) / (max - min)) * (LEVELS.length - 1));
      return LEVELS[Math.min(LEVELS.length - 1, Math.max(0, level))];
    })
    .join("");
}
