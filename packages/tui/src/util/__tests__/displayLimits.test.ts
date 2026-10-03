import { describe, expect, it } from "vitest";
import { capChars, REASONING_RETAIN_MAX, REASONING_DISPLAY_MAX_CHARS } from "../displayLimits.js";

describe("capChars", () => {
  it("preserves short text", () => {
    expect(capChars("abc", 10)).toBe("abc");
  });

  it("prepends an omission notice and keeps the tail when over the limit", () => {
    // The tail is what matters: reasoning state is retained from the end.
    const result = capChars("abcdefghij", 6);
    expect(result).toBe("… (4 earlier char(s) omitted) efghij");
  });

  it("keeps the same window state retains (reasoning tail), not a middle slice", () => {
    const long = "0123456789".repeat(700); // 7000 > REASONING_RETAIN_MAX
    const retained = long.slice(-REASONING_RETAIN_MAX);
    const capped = capChars(retained, REASONING_DISPLAY_MAX_CHARS);
    expect(capped.endsWith(retained.slice(-REASONING_DISPLAY_MAX_CHARS))).toBe(true);
    expect(capped).toContain("omitted");
  });

  it("matches the REASONING_DISPLAY_MAX_CHARS display budget", () => {
    const long = "x".repeat(REASONING_DISPLAY_MAX_CHARS + 40);
    const capped = capChars(long, REASONING_DISPLAY_MAX_CHARS);
    expect(capped.length).toBeLessThanOrEqual(REASONING_DISPLAY_MAX_CHARS + 40);
    expect(capped).toContain("omitted");
  });

  it("caps by code points, so a mid-pair boundary is impossible", () => {
    // 'ab' + 😀×3000 + 'c' is 6,003 UTF-16 units but 3,003 code points. A
    // unit-based cap of 6,000 did NOT trigger; a unit cap of 3,002 would have
    // begun on the low half of a pair. The cap counts code points, so the frame
    // can never show a replacement glyph where a whole emoji was.
    const mixed = "ab" + "😀".repeat(3000) + "c";
    const capped = capChars(mixed, 2500);
    for (let i = 0; i < capped.length; i++) {
      const c = capped.charCodeAt(i);
      if (c >= 0xdc00 && c <= 0xdfff) {
        expect(capped.charCodeAt(i - 1)).toBeGreaterThanOrEqual(0xd800);
        expect(capped.charCodeAt(i - 1)).toBeLessThanOrEqual(0xdbff);
      }
    }
    // And the notice describes what was ACTUALLY dropped, in units: the count
    // is measured from the tail that survived, not from the nominal cap.
    // (Parse the notice with a regex — "char(s)" itself contains ") ".)
    const m = /^… \((\d+) earlier char\(s\) omitted\) /.exec(capped);
    expect(m).not.toBeNull();
    const dropped = Number(m![1]);
    const shown = capped.slice(m![0].length);
    expect(dropped).toBe(mixed.length - shown.length);
    expect(shown.endsWith("c")).toBe(true);
    expect(shown.length).toBe(4999); // 2,499 whole emoji + the ASCII tail
  });
});