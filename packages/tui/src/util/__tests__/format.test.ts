import { describe, expect, it } from "vitest";
import { collapsePlan, curtail, displayModelLabel, formatCertificationBadge, formatDuration, formatTime, modelInfo, providerLabel, providerOfModel } from "../format.js";

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

  it("formatTime renders zero-padded local HH:MM", () => {
    expect(formatTime(new Date(2026, 8, 14, 9, 5).getTime())).toBe("09:05");
    expect(formatTime(new Date(2026, 8, 14, 23, 59).getTime())).toBe("23:59");
  });
});