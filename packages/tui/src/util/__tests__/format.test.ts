import { describe, expect, it } from "vitest";
import { collapsePlan, curtail, curtailToCells, displayModelLabel, displayWidth, formatCertificationBadge, formatDuration, formatTime, modelInfo, providerLabel, providerOfModel, splitByDisplayWidth, tailChars } from "../format.js";

describe("tailChars — code-point-aware tail (mirror of curtail)", () => {
  it("returns text at or under the budget unchanged", () => {
    expect(tailChars("abcdef", 6)).toBe("abcdef");
    expect(tailChars("abcdef", 99)).toBe("abcdef");
  });

  it("keeps the LAST code points, not the first", () => {
    expect(tailChars("abcdef", 3)).toBe("def");
    expect(tailChars("abcdef", 1)).toBe("f");
    expect(tailChars("abcdef", 0)).toBe("");
  });

  it("counts code points, so an emoji is never half-kept", () => {
    const emoji = "😀".repeat(10); // 10 code points, 20 UTF-16 units
    expect(tailChars(emoji, 10)).toBe(emoji);
    expect(tailChars(emoji, 4)).toBe("😀😀😀😀");
  });

  it("never begins on a low surrogate when the boundary lands mid-pair", () => {
    // The regression this exists for: 'ab' + 😀×3000 + 'c' is 6,003 units, so a
    // blind slice(-6000) started on the low half of a pair — invalid UTF-16.
    const mixed = "ab" + "😀".repeat(3000) + "c";
    const out = tailChars(mixed, 6000);
    for (let i = 0; i < out.length; i++) {
      const c = out.charCodeAt(i);
      if (c >= 0xdc00 && c <= 0xdfff) {
        expect(out.charCodeAt(i - 1)).toBeGreaterThanOrEqual(0xd800);
        expect(out.charCodeAt(i - 1)).toBeLessThanOrEqual(0xdbff);
      }
    }
    expect(Array.from(out).length).toBeLessThanOrEqual(6000);
    expect(out.endsWith("c")).toBe(true);
  });
});

describe("format helpers", () => {
  it("displayModelLabel resolves a known registry model and falls back to the id", () => {
    expect(displayModelLabel("gemini-3.6-flash")).toBe("Gemini 3.6 Flash");
    expect(displayModelLabel("totally-unknown-model")).toBe("totally-unknown-model");
  });

  it("providerLabel maps known providers and falls back to the id", () => {
    expect(providerLabel("anthropic")).toBe("Anthropic");
    expect(providerLabel("openrouter")).toBe("OpenRouter");
    expect(providerLabel("phase8-unknown")).toBe("phase8-unknown");
  });

  it("providerOfModel returns the provider id of a known model", () => {
    expect(providerOfModel("gemini-3.6-flash")).toBe("gemini");
  });

  it("qualifies an ambiguous model id by provider (AUDIT-02)", () => {
    // `gpt-4o-mini` is registered under TWO providers with divergent metadata
    // (paid on openai, free on github). Resolving by bare id let the header
    // render the wrong row — the picker says FREE, the chrome says [PAID].
    expect(displayModelLabel("gpt-4o-mini", "github")).toBe("GPT-4o mini (via GitHub)");
    expect(displayModelLabel("gpt-4o-mini", "openai")).toBe("GPT-4o mini");
    expect(providerOfModel("gpt-4o-mini", "github")).toBe("github");
    expect(providerOfModel("gpt-4o-mini", "openai")).toBe("openai");
    expect(modelInfo("gpt-4o-mini", "github")?.isFree).toBe(true);
    expect(modelInfo("gpt-4o-mini", "openai")?.isFree).toBe(false);
  });

  it("falls back to first-match for an id whose provider is unknown (free-form ids)", () => {
    // OpenRouter-style ids are not enumerable; an unknown provider must not
    // resolve to nothing — the documented fallback keeps the old behavior.
    expect(modelInfo("gemini-3.6-flash", "not-a-provider")).toBeUndefined();
    expect(displayModelLabel("totally-unknown-model", "github")).toBe("totally-unknown-model");
  });

  it("formatDuration switches unit at a second and renders nothing when unmeasured", () => {
    expect(formatDuration(234)).toBe("234ms");
    expect(formatDuration(0)).toBe("0ms");
    expect(formatDuration(999)).toBe("999ms");
    expect(formatDuration(1000)).toBe("1.0s");
    expect(formatDuration(1234)).toBe("1.2s");
    // No measurement, or a value that cannot be one, renders NOTHING — never a
    // fabricated `0ms` for a tool whose duration core did not report.
    expect(formatDuration(undefined)).toBe("");
    expect(formatDuration(Number.NaN)).toBe("");
    expect(formatDuration(-5)).toBe("");
  });

  it("curtail truncates long text with an ellipsis and keeps short text", () => {
    expect(curtail("1234567890", 8)).toBe("1234567…");
    expect(curtail("short", 8)).toBe("short");
    expect(curtail("", 4)).toBe("");
    expect(curtail("hello", 0)).toBe("");
    expect(curtail("hello", -1)).toBe("");
    expect(curtail("hello", 1)).toBe("…");
  });

  it("curtail is code-point aware (emoji/CJK do not split surrogate pairs)", () => {
    // 😀 is one code point; truncation must never produce a broken surrogate.
    const s = "а😀б😀в😀г😀д😀"; // uses Cyrillic + emoji (all single code points)
    const out = curtail(s, 7);
    expect(Array.from(out).length).toBe(7);
    // no lone high surrogates (would mean we split an emoji)
    for (let i = 0; i < out.length; i++) {
      const code = out.charCodeAt(i);
      if (code >= 0xd800 && code <= 0xdbff) {
        expect(out.charCodeAt(i + 1)).toBeGreaterThanOrEqual(0xdc00);
      }
    }
  });

  it("F5: curtailToCells honours a terminal-CELL budget (not code points)", () => {
    // "中文" is 2 code points but 4 cells; a code-point curtail let it overflow
    // the cell budget it had been padded to.
    expect(displayWidth("中文")).toBe(4);
    expect(curtailToCells("中文中文", 5)).toBe("中文…"); // 4 cells + ellipsis
    expect(curtailToCells("abc", 3)).toBe("abc");
    expect(curtailToCells("abcd", 3)).toBe("ab…");
    expect(curtailToCells("abc", 0)).toBe("");
    expect(curtailToCells("abc", 1)).toBe("…");
    // Never splits a surrogate pair.
    expect(curtailToCells("😀😀😀", 5)).toBe("😀😀…");
  });

  it("F5: splitByDisplayWidth never overflows and never straddles a wide glyph", () => {
    expect(splitByDisplayWidth("中文中文", 4)).toEqual(["中文", "中文"]);
    // 3-cell budget: a 2-cell glyph that would straddle starts the next chunk.
    expect(splitByDisplayWidth("abcde", 3)).toEqual(["abc", "de"]);
    // A glyph wider than the whole budget is emitted alone, never dropped.
    expect(splitByDisplayWidth("中", 1)).toEqual(["中"]);
    expect(splitByDisplayWidth("", 4)).toEqual([""]);
  });

  it("collapsePlan caps a multi-line plan at two width-fitting lines", () => {
    const plan = "first step\nsecond step\nthird step\nfourth step";
    const { lines, hidden } = collapsePlan(plan, 120);
    expect(lines).toEqual(["first step", "second step"]);
    expect(hidden).toBe(2);
  });

  it("collapsePlan curtails an over-long single line to the width budget", () => {
    const long = "x".repeat(200);
    const { lines, hidden } = collapsePlan(long, 80);
    expect(lines.length).toBe(1);
    expect(Array.from(lines[0]).length).toBeLessThanOrEqual(68); // avail = 80-12
    expect(hidden).toBe(0);
  });

  it("collapsePlan drops blank lines and floors the width budget", () => {
    const plan = "\n  \nreal line\n";
    const { lines, hidden } = collapsePlan(plan, 10); // avail floors at 20
    expect(lines.length).toBe(1);
    expect(lines[0]).toBe("real line");
    expect(hidden).toBe(0);
  });

  it("collapsePlan handles an empty plan", () => {
    expect(collapsePlan("", 80)).toEqual({ lines: [], hidden: 0 });
  });

  it("formatCertificationBadge labels live by how it was earned", () => {
    expect(formatCertificationBadge("live", "live")).toBe(" [✅ live]");
    expect(formatCertificationBadge("live", "mock")).toBe(" [✅ mock]");
    // Unrecorded mode defaults to the conservative label — absence of a mode is
    // not evidence of a live pass.
    expect(formatCertificationBadge("live")).toBe(" [✅ mock]");
    expect(formatCertificationBadge("broken", "live")).toBe(" [❌ broken]");
    expect(formatCertificationBadge("untested")).toBe(" [⚠ untested]");
    expect(formatCertificationBadge(undefined)).toBe("");
  });

  it("never renders a tick for a model the gateway refuses (Phase 38.3)", () => {
    // Probe N: two OpenRouter ids answered HTTP 403 for an Anvil-shaped request.
    // They shipped as `certified: "live"` from a mock run, so the picker offered
    // them as working choices. The registry now marks them "broken" (core test
    // `unreachableModels.test.ts` owns the data); this owns the rendering, and
    // asserts the user-visible half of that contract.
    for (const status of ["broken", "untested"] as const) {
      const badge = formatCertificationBadge(status, "live");
      expect(badge, `a ${status} model must not render as available`).not.toContain("✅");
    }
    // "broken" is specific; "untested" is merely unknown. Collapsing them would
    // overstate what Anvil knows.
    expect(formatCertificationBadge("broken", "live")).not.toBe(
      formatCertificationBadge("untested", "live")
    );
  });

  it("formatTime renders zero-padded local HH:MM", () => {
    expect(formatTime(new Date(2026, 8, 14, 9, 5).getTime())).toBe("09:05");
    expect(formatTime(new Date(2026, 8, 14, 23, 59).getTime())).toBe("23:59");
  });
});