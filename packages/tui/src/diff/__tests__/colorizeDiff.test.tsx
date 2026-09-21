import { describe, expect, it } from "vitest";
import { ColorizedDiff, MAX_DIFF_ROWS } from "../colorizeDiff.js";
import { frameText, renderThemed, tick } from "../../test-utils/testRender.js";

const SAMPLE = [
  "--- a/app.ts",
  "+++ b/app.ts",
  "@@ -3,4 +3,4 @@",
  " context line",
  "-const oldName = 1;",
  "+const newName = 1;",
  " more context",
].join("\n");

async function diffFrame(diff: string): Promise<string> {
  const app = renderThemed(<ColorizedDiff diff={diff} />);
  await tick();
  const frame = frameText(app.lastFrame);
  app.unmount();
  return frame;
}

describe("ColorizedDiff", () => {
  it("keeps the │ rule in one column across add, delete, and context rows", async () => {
    // Regression: the add branch blanked the old-number column with 4 cells
    // instead of 5, so every added line's rule sat one column left of the rest
    // and the gutter jogged mid-hunk.
    const cols = (await diffFrame(SAMPLE))
      .split("\n")
      .filter((line) => line.includes("│"))
      .map((line) => line.indexOf("│"));
    expect(cols.length).toBeGreaterThanOrEqual(3); // context + del + add
    expect(new Set(cols).size).toBe(1);
  });

  it("omits rows past the cap with a count instead of silently truncating", async () => {
    const body = Array.from({ length: MAX_DIFF_ROWS + 12 }, (_, i) => `+line ${i}`);
    const frame = await diffFrame(["--- a/f", "+++ b/f", "@@ -1,1 +1,1 @@", ...body].join("\n"));
    expect(frame).toContain("more diff line(s) omitted");
  });
});
