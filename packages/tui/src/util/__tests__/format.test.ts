import { describe, expect, it } from "vitest";
import { curtail, displayModelLabel, providerLabel, providerOfModel } from "../format.js";

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

  it("curtail truncates long text with an ellipsis and keeps short text", () => {
    expect(curtail("1234567890", 8)).toBe("1234567…");
    expect(curtail("short", 8)).toBe("short");
    expect(curtail("", 4)).toBe("");
  });

  it("curtail is code-point aware (emoji/CJK do not split surrogate pairs)", () => {
    // 😀 is one code point; truncation must never produce a broken surrogate.
    const s = "а😀б😀в😀г😀д😀"; // uses Cyrillic + emoji (all single code points)
    const out = curtail(s, 7);
    expect(Array.from(out).length).toBe(7);
    expect([...out].every((ch) => !/\uD800/.test(ch) || true)).toBe(true);
    // no lone high surrogates (would mean we split an emoji)
    for (let i = 0; i < out.length; i++) {
      const code = out.charCodeAt(i);
      if (code >= 0xd800 && code <= 0xdbff) {
        expect(out.charCodeAt(i + 1)).toBeGreaterThanOrEqual(0xdc00);
      }
    }
  });
});