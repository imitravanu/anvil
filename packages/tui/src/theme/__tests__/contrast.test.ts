import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { THEMES } from "../theme.js";

/**
 * Phase 28.9 tinted-lane contrast contract (audit follow-up, 2026-10-05).
 *
 * Phase 28.2 paints the add/del diff lanes with `diffAddBg`/`diffDelBg` and
 * composites readable text directly on those tints: the sign, the code, word
 * highlights, and the gutter line numbers. The test harness is non-TTY —
 * chalk emits no ANSI, so rendered frames carry no colour and the visual
 * baselines cannot police this. Like the 28.8 dim contract, the rule is
 * therefore enforced at the palette + source level:
 *
 *  - every foreground token production actually composites on a tint is
 *    listed in TINTED_PAIRS with the ratio WCAG AA requires (4.5, normal
 *    text). A named-colour token (e.g. "green") resolves in the terminal's
 *    own palette, so its ratio is unknowable here; those pairs are skipped.
 *  - the quietest readable tier (`textMuted`) must never sit on a tint: its
 *    whole point is to be dark, and hacker's `#003b00` peaks at ~1.6:1 even
 *    against pure black — no tint can rescue it. The diff gutters use
 *    `textSecondary`, and that choice is asserted against the sources so a
 *    future edit cannot silently put the unreadable tier back on the tint.
 */

// Up two from src/theme/__tests__ → src/.
const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** WCAG 2.x AA for normal-weight text. */
const AA_MIN_RATIO = 4.5;

function parseHex(color: string): [number, number, number] | null {
  const m = /^#([0-9a-fA-F]{6})$/.exec(color);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const channel = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio, or null when either side is not a hex literal. */
function contrastRatio(fg: string, bg: string): number | null {
  const a = parseHex(fg);
  const b = parseHex(bg);
  if (!a || !b) return null;
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The complete inventory of foreground tokens composited on the lane tints in
 * production source, and where each is painted. Word highlights render
 * `bold inverse`, which swaps the pair — contrast is symmetric, so the same
 * ratio covers them. Keep this in step with `colorizeDiff.tsx` and
 * `SideBySideDiff.tsx`; adding a tinted fg means adding its pair here.
 */
const TINTED_PAIRS = [
  { fg: "toolDone", bg: "diffAddBg", where: "added-lane sign, code and word highlights" },
  { fg: "toolError", bg: "diffDelBg", where: "deleted-lane sign, code and word highlights" },
  { fg: "textSecondary", bg: "diffAddBg", where: "added-lane gutter line numbers" },
  { fg: "textSecondary", bg: "diffDelBg", where: "deleted-lane gutter line numbers" },
] as const;

/** Decorative: the boot wordmark's heat ramp blends pixel tints mid-flourish. */
const DECORATIVE_TINT_SITES = ["components/Wordmark.tsx"];

describe("28.9 tinted-lane contrast contract", () => {
  it("keeps the default reading and hint text legible on its terminal surface", () => {
    for (const token of ["textPrimary", "textSecondary", "textMuted"] as const) {
      expect(contrastRatio(THEMES.dark.colors[token], THEMES.dark.colors.surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(THEMES.highContrast.colors[token], THEMES.highContrast.colors.surface)).toBeGreaterThanOrEqual(7);
    }
  });
  it("keeps every measurable foreground-on-tint pair at WCAG AA", () => {
    const failures: string[] = [];
    for (const [name, theme] of Object.entries(THEMES)) {
      for (const pair of TINTED_PAIRS) {
        const ratio = contrastRatio(theme.colors[pair.fg], theme.colors[pair.bg]);
        if (ratio === null) continue;
        if (ratio < AA_MIN_RATIO) {
          failures.push(
            `${name}: ${pair.fg} on ${pair.bg} = ${ratio.toFixed(2)}:1 (needs >= ${AA_MIN_RATIO}:1) — ${pair.where}`
          );
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it("stays measurable on the hex-palette themes instead of skipping everything", () => {
    // dark/light/highContrast use terminal keywords for these tokens; their
    // ratios depend on the host palette and cannot be computed here. The
    // three hex-palette themes must remain the tested set — if a refactor
    // turns them into keywords too, this contract silently empties out and
    // this assertion is what notices.
    const measurable = Object.entries(THEMES)
      .filter(([, theme]) =>
        TINTED_PAIRS.some((p) => contrastRatio(theme.colors[p.fg], theme.colors[p.bg]) !== null)
      )
      .map(([name]) => name)
      .sort();
    expect(measurable).toEqual(["dark", "forge", "hacker", "highContrast", "midnight"]);
  });

  it("keeps the quietest readable tier off the diff tints, at the source", () => {
    // textMuted is legible on plain backgrounds but cannot reach AA on these
    // tints (hacker's #003b00 peaks at ~1.6:1 against pure black), so the
    // lane gutter must use textSecondary. No rendered assertion can see this
    // (ANSI-free harness), so the rule is enforced against the sources that
    // composite the gutters. `//`-comment lines are prose about the rule, not
    // uses of it — the same filtering the 28.8 dim contract applies.
    for (const rel of ["diff/colorizeDiff.tsx", "diff/SideBySideDiff.tsx"]) {
      const code = readFileSync(join(SRC_ROOT, rel), "utf8")
        .split("\n")
        .filter((line) => !/^\s*\/\//.test(line))
        .join("\n");
      expect(
        code.includes("textMuted"),
        `${rel} composites its gutter on a lane tint — textMuted cannot meet AA there; use textSecondary`
      ).toBe(false);
    }
  });

  it("keeps the decorative tint sites out of this contract's inventory", () => {
    // Wordmark's tint is animation chrome, not readable text; if a real text
    // surface ever appears there, this list (and TINTED_PAIRS) must grow.
    for (const rel of DECORATIVE_TINT_SITES) {
      const source = readFileSync(join(SRC_ROOT, rel), "utf8");
      expect(source.includes("backgroundColor"), `${rel} still owns a tint site`).toBe(true);
    }
  });
});
