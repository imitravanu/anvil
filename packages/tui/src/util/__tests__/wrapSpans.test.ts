import { describe, expect, it } from "vitest";
import { wrapSpans } from "../wrapSpans.js";

describe("wrapSpans", () => {
  it("wraps long text into rows within the width", () => {
    const rows = wrapSpans([{ text: "aa bb cc dd ee ff" }], 5);
    expect(rows.map((r) => r.spans.map((s) => s.text).join(""))).toEqual([
      "aa bb",
      "cc dd",
      "ee ff",
    ]);
  });

  it("carries styling through the wrap", () => {
    const rows = wrapSpans(
      [{ text: "plain " }, { text: "bold words here", bold: true }],
      10
    );
    const flat = rows.flatMap((r) => r.spans);
    expect(flat.find((s) => s.text === "bold")?.bold).toBe(true);
    expect(flat.find((s) => s.text === "words")?.bold).toBe(true);
  });

  it("hard-splits a single word longer than the width", () => {
    const rows = wrapSpans([{ text: "abcdefghij" }], 4);
    expect(rows.map((r) => r.spans.map((s) => s.text).join(""))).toEqual([
      "abcd",
      "efgh",
      "ij",
    ]);
  });

  it("returns one empty row for empty input", () => {
    expect(wrapSpans([{ text: "" }], 10)).toEqual([{ spans: [] }]);
  });

  it("F5: wraps by terminal CELLS, so CJK rows never exceed the width", () => {
    // 6 code points but 12 cells at width 4 → 3 rows of 2 glyphs each.
    const rows = wrapSpans([{ text: "中文中文中文" }], 4);
    expect(rows.map((r) => r.spans.map((s) => s.text).join(""))).toEqual(["中文", "中文", "中文"]);
  });

  it("F5: hard-splits an over-wide word by cells, not code points", () => {
    const rows = wrapSpans([{ text: "😀😀😀😀" }], 4);
    expect(rows.map((r) => r.spans.map((s) => s.text).join(""))).toEqual(["😀😀", "😀😀"]);
  });
});
