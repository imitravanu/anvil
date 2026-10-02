import { describe, expect, it } from "vitest";
import { capChars, REASONING_RETAIN_MAX, REASONING_DISPLAY_MAX_CHARS } from "../displayLimits.js";

describe("capChars", () => {
  it("preserves short text", () => {
    expect(capChars("abc", 10)).toBe("abc");
  });

  it("appends an omission notice when over the limit", () => {
    const result = capChars("abcdefghij", 6);
    expect(result).toBe("abcdef … (4 more char(s) omitted)");
  });

  it("matches the REASONING_DISPLAY_MAX_CHARS display budget", () => {
    const long = "x".repeat(REASONING_DISPLAY_MAX_CHARS + 40);
    const capped = capChars(long, REASONING_DISPLAY_MAX_CHARS);
    expect(capped.length).toBeLessThanOrEqual(REASONING_DISPLAY_MAX_CHARS + 40);
    expect(capped).toContain("omitted");
  });
});