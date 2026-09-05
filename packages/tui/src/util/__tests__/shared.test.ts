import { describe, expect, it } from "vitest";
import { windowOffset } from "../../hooks/useWindowedList.js";
import { formatPricingTag, pricingKind } from "../format.js";

describe("windowOffset", () => {
  it("shows everything when the list fits", () => {
    expect(windowOffset(5, 0, 8)).toEqual({ offset: 0, hasAbove: false, hasBelow: false });
    expect(windowOffset(8, 7, 8)).toEqual({ offset: 0, hasAbove: false, hasBelow: false });
  });

  it("centers the window and flags edges", () => {
    expect(windowOffset(20, 0, 8)).toEqual({ offset: 0, hasAbove: false, hasBelow: true });
    expect(windowOffset(20, 10, 8)).toEqual({ offset: 6, hasAbove: true, hasBelow: true });
    expect(windowOffset(20, 19, 8)).toEqual({ offset: 12, hasAbove: true, hasBelow: false });
  });
});

describe("pricingKind + formatPricingTag", () => {
  it("decides free/paid/unknown once for all chrome", () => {
    expect(pricingKind(true)).toBe("free");
    expect(pricingKind(false)).toBe("paid");
    expect(pricingKind(undefined)).toBe("unknown");
    expect(formatPricingTag(true)).toBe(" [FREE]");
    expect(formatPricingTag(false)).toBe(" [PAID]");
    expect(formatPricingTag(undefined)).toBe("");
  });
});
