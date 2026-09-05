import { describe, expect, it } from "vitest";
import { formatRewindList, formatRewindResult } from "../rewind.js";

describe("formatRewindList", () => {
  it("is honest when empty", () => {
    const out = formatRewindList([]);
    expect(out).toContain("No checkpoints");
    expect(out).toContain("can't be rewound");
  });

  it("lists checkpoints with the honesty line", () => {
    const out = formatRewindList([
      { id: 1, ts: "t1", files: 2, skipped: 0 },
      { id: 2, ts: "t2", files: 1, skipped: 1 },
    ]);
    expect(out).toContain("#1  2 files");
    expect(out).toContain("#2  1 file");
    expect(out).toContain("[1 skipped]");
    expect(out).toContain("/rewind <n>");
    expect(out).toContain("can't be rewound");
  });
});

describe("formatRewindResult", () => {
  it("marks success and failure distinctly", () => {
    expect(
      formatRewindResult({ ok: true, restored: ["a"], deleted: [], errors: [], message: "restored 1: a" })
    ).toBe("✓ Rewound. restored 1: a");
    expect(
      formatRewindResult({ ok: false, restored: [], deleted: [], errors: ["x"], message: "No checkpoint #9 in this session." })
    ).toBe("✗ Rewind failed. No checkpoint #9 in this session.");
  });
});
