import { describe, expect, it } from "vitest";
import { focusTransition } from "../useFocusZone.js";

describe("focusTransition", () => {
  it("toggles input↔transcript on Tab", () => {
    const s0 = { zone: "input" as const };
    expect(focusTransition(s0, { type: "tab", overlaysOpen: false, slashMenuOpen: false }))
      .toEqual({ zone: "transcript" });
    expect(
      focusTransition({ zone: "transcript" }, { type: "tab", overlaysOpen: false, slashMenuOpen: false })
    ).toEqual({ zone: "input" });
  });

  it("never steals Tab from the slash menu or an overlay", () => {
    const s0 = { zone: "input" as const };
    expect(focusTransition(s0, { type: "tab", overlaysOpen: false, slashMenuOpen: true })).toEqual(s0);
    expect(focusTransition(s0, { type: "tab", overlaysOpen: true, slashMenuOpen: false })).toEqual(s0);
  });

  it("overlays force the overlay zone and release back to input", () => {
    expect(focusTransition({ zone: "transcript" }, { type: "overlay", open: true }))
      .toEqual({ zone: "overlay" });
    expect(focusTransition({ zone: "overlay" }, { type: "overlay", open: false }))
      .toEqual({ zone: "input" });
  });

  it("Esc lands in input, never disturbs an overlay", () => {
    expect(focusTransition({ zone: "transcript" }, { type: "escape" })).toEqual({ zone: "input" });
    expect(focusTransition({ zone: "input" }, { type: "escape" })).toEqual({ zone: "input" });
    const overlay = { zone: "overlay" as const };
    expect(focusTransition(overlay, { type: "escape" })).toEqual(overlay);
  });
});
