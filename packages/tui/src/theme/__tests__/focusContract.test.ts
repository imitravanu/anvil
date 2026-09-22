import { describe, expect, it } from "vitest";
import { THEMES } from "../theme.js";
import { SEMANTIC_COLOR_KEYS } from "../themes.js";

/**
 * DW-3.3 focus-border contract.
 *
 * The frame of whichever surface owns keyboard input carries the `borderFocus`
 * token, and App renders exactly one such surface at a time, so that border is
 * the "your keys land here" signal. It is therefore load-bearing: a theme whose
 * focus border equals its structural border renders the affordance as nothing,
 * and no other test can see it (the harness is non-TTY, so chalk emits no ANSI
 * and every frame assertion is text-only by design).
 */
describe("DW-3.3 focus-border contract", () => {
  it("defines a non-empty focus border on every built-in theme", () => {
    for (const [name, theme] of Object.entries(THEMES)) {
      expect(theme.colors.borderFocus, `${name}: borderFocus must be a string`).toBeTypeOf("string");
      expect(theme.colors.borderFocus.length, `${name}: borderFocus must not be empty`).toBeGreaterThan(0);
    }
  });

  it("keeps the focus border distinct from the structural border in every theme", () => {
    for (const [name, theme] of Object.entries(THEMES)) {
      expect(
        theme.colors.borderFocus,
        `${name}: borderFocus must differ from border, otherwise the focus affordance is invisible`
      ).not.toBe(theme.colors.border);
    }
  });

  it("declares the focus token as semantic, so custom themes must supply it", () => {
    expect(SEMANTIC_COLOR_KEYS).toContain("borderFocus");
  });
});
