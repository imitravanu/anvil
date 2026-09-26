import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { THEMES } from "../theme.js";
import { SEMANTIC_COLOR_KEYS } from "../themes.js";

/**
 * Phase 28.8 readable-text contract.
 *
 * The forge philosophy: `dim` is decoration only. Text a human must read
 * belongs to `textSecondary` (secondary readable) or `textMuted` (quietest
 * readable). The test harness is non-TTY — chalk emits no ANSI, so frames
 * carry no colour information and rendered-output assertions cannot police
 * this. The contract is therefore enforced at the source level, the same
 * way the gate's residual drain scan keeps slop from regenerating: every
 * `dimColor`/`colors.dim` use in production source must be an explicitly
 * listed decorative use. A new readable-text dim use fails here; a new
 * legitimate decorative use updates the map consciously.
 */

// Up two from src/theme/__tests__ → src/.
const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// Test-only trees never ship; scanning them would police fixtures, not UI.
const SKIPPED_DIRS = new Set(["__tests__", "__visual__", "test-utils"]);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIPPED_DIRS.has(entry.name)) continue;
      out.push(...sourceFiles(join(dir, entry.name)));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry.name) || entry.name.includes(".test.")) continue;
    out.push(join(dir, entry.name));
  }
  return out;
}

// `//`-comment lines are prose about the contract, not uses of it.
function dimUseCount(path: string): number {
  const code = readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
  return (code.match(/dimColor|colors\.dim/g) ?? []).length;
}

/**
 * The complete inventory of sanctioned decorative uses, per file. Each entry
 * is decoration by inspection (28.8 pass, 2026-09-26):
 *  - Header/StatusBar/App: `│` and `─` rules and separators
 *  - InputBar: the busy-time border (borders are decoration by definition)
 *  - MarkdownView: strikethrough (semantic markdown attr), table rule, quote
 *    marker `▍`, horizontal rule, and the code-block bar `▎`
 * Everything else — hints, badges, summaries, notices, tab names, scroll
 * indicators, timestamps, gutter line numbers — must be text tiers.
 */
const EXPECTED_DIM_USES: Record<string, number> = {
  "components/Header.tsx": 3,
  "components/StatusBar.tsx": 3,
  "components/App.tsx": 1,
  "components/InputBar.tsx": 1,
  "markdown/MarkdownView.tsx": 5,
};

describe("28.8 readable-text contract", () => {
  it("reserves dim for decoration across all production TUI source", () => {
    const violations: string[] = [];
    for (const file of sourceFiles(SRC_ROOT)) {
      const rel = file.slice(SRC_ROOT.length + 1);
      const expected = EXPECTED_DIM_USES[rel] ?? 0;
      const actual = dimUseCount(file);
      if (actual !== expected) {
        violations.push(
          `${rel}: found ${actual} dim use(s), expected ${expected} — readable text belongs to textSecondary/textMuted`
        );
      }
    }
    expect(violations).toEqual([]);
  });

  it("defines all three tiers as non-empty tokens on every built-in theme", () => {
    for (const [name, theme] of Object.entries(THEMES)) {
      for (const token of ["dim", "textMuted", "textSecondary"] as const) {
        const value = theme.colors[token];
        expect(typeof value, `${name}.${token} must be a string`).toBe("string");
        expect(value.length, `${name}.${token} must not be empty`).toBeGreaterThan(0);
      }
    }
  });

  it("keeps forge's three tiers distinct — its dim is deliberately unreadable", () => {
    // Other themes may collapse the tiers (dark's gray dim is legible), but
    // forge created the three-tier philosophy: decoration must be separable
    // from both readable tiers, or 28.8's legibility goal is unreachable.
    const { dim, textMuted, textSecondary } = THEMES.forge.colors;
    expect(dim).not.toBe(textMuted);
    expect(dim).not.toBe(textSecondary);
    expect(textMuted).not.toBe(textSecondary);
  });

  it("declares both readable tiers as semantic keys, so custom themes must supply them", () => {
    expect(SEMANTIC_COLOR_KEYS).toContain("textSecondary");
    expect(SEMANTIC_COLOR_KEYS).toContain("textMuted");
  });
});
