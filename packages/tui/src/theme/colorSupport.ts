/**
 * Terminal color-capability detection (environment layer).
 * Pure over an injected env record; unit-tested without a terminal.
 * Follows the `adaptive.ts` precedent: no behavior change by itself, callers
 * opt in. `NO_COLOR` (presence, any value) and `TERM=dumb` mean no color;
 * `COLORTERM=truecolor|24bit` means full hex; 256-color terminals sit in the
 * middle; anything else present and non-dumb is basic ANSI. Missing `TERM`
 * reads as basic — Ink/chalk still emit ANSI there and tests run TERM-less.
 */
export type ColorSupport = "truecolor" | "palette256" | "basic" | "none";

export function detectColorSupport(
  env: Record<string, string | undefined> = process.env
): ColorSupport {
  if (env.NO_COLOR !== undefined) return "none";
  const term = (env.TERM ?? "").trim().toLowerCase();
  if (term === "dumb") return "none";
  const colorterm = (env.COLORTERM ?? "").trim().toLowerCase();
  if (colorterm.includes("truecolor") || colorterm.includes("24bit")) return "truecolor";
  if (term.includes("256color")) return "palette256";
  if (colorterm.length > 0) return "palette256";
  if (term.length > 0) return "basic";
  return "basic";
}
