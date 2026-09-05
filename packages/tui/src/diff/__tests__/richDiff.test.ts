import { describe, expect, it } from "vitest";
import { parseDiff } from "../parseDiff.js";
import { diffWords, pairRows } from "../wordDiff.js";

const SAMPLE = [
  "--- a/app.ts",
  "+++ b/app.ts",
  "@@ -3,4 +3,4 @@",
  " context line",
  "-const oldName = 1;",
  "+const newName = 1;",
  " more context",
  "@@ -10,3 +10,3 @@",
  "-removed entirely",
  "+added instead",
  "+extra add",
].join("\n");

describe("parseDiff", () => {
  it("classifies headers, hunks, and lines with running line numbers", () => {
    const rows = parseDiff(SAMPLE);
    expect(rows[0]).toEqual({ kind: "file", text: "--- a/app.ts" });
    expect(rows[1]).toEqual({ kind: "file", text: "+++ b/app.ts" });
    expect(rows[2]).toMatchObject({ kind: "hunk", oldStart: 3, newStart: 3 });
    expect(rows[3]).toMatchObject({ kind: "context", oldNo: 3, newNo: 3 });
    expect(rows[4]).toMatchObject({ kind: "del", text: "const oldName = 1;", oldNo: 4 });
    expect(rows[5]).toMatchObject({ kind: "add", text: "const newName = 1;", newNo: 4 });
    expect(rows[6]).toMatchObject({ kind: "context", oldNo: 5, newNo: 5 });
    expect(rows[7]).toMatchObject({ kind: "hunk", oldStart: 10, newStart: 10 });
    expect(rows[8]).toMatchObject({ kind: "del", oldNo: 10 });
    expect(rows[9]).toMatchObject({ kind: "add", newNo: 10 });
    expect(rows[10]).toMatchObject({ kind: "add", newNo: 11 });
  });

  it("treats pre-hunk lines as meta, never crashes on odd input", () => {
    expect(parseDiff("")).toEqual([]);
    expect(parseDiff("just some text")).toEqual([{ kind: "meta", text: "just some text" }]);
  });

  it("keeps genuinely empty hunk lines as context (numbers stay in sync)", () => {
    const rows = parseDiff("@@ -1,3 +1,3 @@\n a\n\n b");
    expect(rows[1]).toMatchObject({ kind: "context", text: "a", oldNo: 1, newNo: 1 });
    expect(rows[2]).toMatchObject({ kind: "context", text: "", oldNo: 2, newNo: 2 });
    expect(rows[3]).toMatchObject({ kind: "context", text: "b", oldNo: 3, newNo: 3 });
  });
});

describe("diffWords", () => {
  it("marks only the changed words in a paired line", () => {    const { del, add } = diffWords("const oldName = 1;", "const newName = 1;");
    expect(del.filter((s) => s.changed).map((s) => s.text)).toEqual(["oldName"]);
    expect(add.filter((s) => s.changed).map((s) => s.text)).toEqual(["newName"]);
    expect(del.filter((s) => !s.changed && s.text.trim()).length).toBeGreaterThan(0);
  });

  it("handles identical and fully-different lines", () => {
    const same = diffWords("abc", "abc");
    expect(same.del.every((s) => !s.changed)).toBe(true);
    const diff = diffWords("aaa", "bbb");
    expect(diff.del.every((s) => s.changed)).toBe(true);
    expect(diff.add.every((s) => s.changed)).toBe(true);
  });

  it("bails out to fully-changed on huge lines instead of O(n*m) LCS", () => {
    const big = Array.from({ length: 300 }, (_, i) => `w${i}`).join(" ");
    const start = Date.now();
    const { del } = diffWords(big, `${big} tail`);
    expect(Date.now() - start).toBeLessThan(1000);
    expect(del.some((s) => s.changed)).toBe(true);
  });
});

describe("pairRows", () => {
  it("pairs del/add runs and marks leftovers fully changed", () => {
    const rows = parseDiff(SAMPLE);
    const segs = pairRows(rows, (r) => r.text);
    // rows[4]/rows[5] paired: only the name differs
    expect(segs.get(4)!.filter((s) => s.changed).map((s) => s.text)).toEqual(["oldName"]);
    expect(segs.get(5)!.filter((s) => s.changed).map((s) => s.text)).toEqual(["newName"]);
    // rows[8]/rows[9] paired; rows[10] unpaired add → fully changed
    expect(segs.get(10)!.every((s) => s.changed)).toBe(true);
  });
});
