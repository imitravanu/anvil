import { describe, expect, it } from "vitest";
import { CHROME, meter, rule } from "../chrome.js";

describe("CHROME library", () => {
  it("exposes single-character glyphs in every group", () => {
    for (const group of Object.values(CHROME)) {
      for (const glyph of Object.values(group)) {
        expect(typeof glyph).toBe("string");
        expect([...glyph].length).toBe(1);
      }
    }
  });
});

describe("meter", () => {
  it("fills proportionally and clamps", () => {
    expect(meter(0.6, 10)).toBe("██████░░░░");
    expect(meter(0, 4)).toBe("░░░░");
    expect(meter(1, 3)).toBe("███");
    expect(meter(2, 3)).toBe("███");
    expect(meter(-1, 3)).toBe("░░░");
  });
});

describe("rule", () => {
  it("repeats the horizontal line", () => {
    expect(rule(5)).toBe("─────");
    expect(rule(0)).toBe("");
    expect(rule(-3)).toBe("");
  });
});
