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
});
