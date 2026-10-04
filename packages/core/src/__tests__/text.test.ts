import { describe, expect, it } from "vitest";
import { headChars } from "../text.js";
import { capReport } from "../agent/subagent.js";
import { SUB_AGENT_REPORT_MAX_CHARS } from "../config/constants.js";

// Mirrors the TUI's headChars contract (packages/tui/src/util/format.ts): a
// cap must never leave half a surrogate pair in retained text.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

describe("headChars — code-point-aware head cap", () => {
  it("returns text at or under the budget unchanged, and floors at zero", () => {
    expect(headChars("abcdef", 6)).toBe("abcdef");
    expect(headChars("abcdef", 99)).toBe("abcdef");
    expect(headChars("abcdef", 0)).toBe("");
    expect(headChars("abcdef", -1)).toBe("");
  });

  it("keeps the first code points, not the last", () => {
    expect(headChars("abcdef", 3)).toBe("abc");
    expect(headChars("abcdef", 1)).toBe("a");
  });

  it("never ends on a high surrogate when the boundary lands mid-pair", () => {
    // 3,999 ASCII + emoji + tail is 4,001 code points / 4,002 units: a blind
    // slice(0, 4000) kept the emoji's high half and dropped its low half.
    const mixed = "a".repeat(3999) + "😀" + "b";
    const out = headChars(mixed, 4000);
    const last = out.charCodeAt(out.length - 1);
    expect(last >= 0xd800 && last <= 0xdbff).toBe(false);
    expect(out.endsWith("😀")).toBe(true);
    expect(LONE_SURROGATE.test(out)).toBe(false);
  });

  it("does not truncate an astral-heavy string that fits in code points", () => {
    const emoji = "😀".repeat(100); // 200 units, 100 code points
    expect(headChars(emoji, 200)).toBe(emoji);
    expect(headChars(emoji, 100)).toBe(emoji);
    expect(headChars(emoji, 99)).toBe("😀".repeat(99));
  });
});

describe("capReport — the sub-agent report rides back to the parent model", () => {
  it("keeps whole code points at the cap", () => {
    const report = "a".repeat(SUB_AGENT_REPORT_MAX_CHARS - 1) + "😀" + "tail";
    const capped = capReport(report);
    expect(capped).toContain("[report truncated]");
    expect(capped).toContain("😀");
    expect(LONE_SURROGATE.test(capped)).toBe(false);
  });

  it("leaves a report at or under the cap untouched", () => {
    expect(capReport("short report")).toBe("short report");
  });
});
