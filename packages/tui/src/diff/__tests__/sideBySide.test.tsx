import { describe, expect, it } from "vitest";
import { parseDiff } from "../parseDiff.js";
import { pairSideRows } from "../sideBySide.js";
import { SideBySideDiff } from "../SideBySideDiff.js";
import { frameText, renderThemed } from "../../test-utils/testRender.js";

const DIFF = [
  "--- a/app.ts",
  "+++ b/app.ts",
  "@@ -3,4 +3,4 @@",
  " context",
  "-const oldName = 1;",
  "-const gone = 2;",
  "+const newName = 1;",
  " tail",
].join("\n");

describe("pairSideRows", () => {
  it("banners file and hunk rows full-width", () => {
    const paired = pairSideRows(parseDiff(DIFF));
    expect(paired[0]).toMatchObject({ kind: "banner", tone: "file" });
    expect(paired[1]).toMatchObject({ kind: "banner", tone: "file" });
    expect(paired[2]).toMatchObject({ kind: "banner", tone: "hunk" });
  });

  it("pairs context with itself and changed lines index-wise", () => {
    const paired = pairSideRows(parseDiff(DIFF));
    const pairs = paired.filter((r) => r.kind === "pair");
    expect(pairs).toHaveLength(4);
    expect(pairs[0]).toMatchObject({
      left: { text: "context", tone: "context" },
      right: { text: "context", tone: "context" },
    });
    expect(pairs[1]).toMatchObject({
      left: { text: "const oldName = 1;", tone: "del" },
      right: { text: "const newName = 1;", tone: "add" },
    });
    // Leftover deletion pairs against blank.
    expect(pairs[2]).toMatchObject({
      left: { text: "const gone = 2;", tone: "del" },
      right: { text: "", tone: "blank" },
    });
    expect(pairs[3]).toMatchObject({
      left: { text: "tail", tone: "context" },
      right: { text: "tail", tone: "context" },
    });
  });

  it("pairs pure insertions against blank left cells", () => {
    const rows = parseDiff("@@ -1,1 +1,2 @@\n same\n+added\n");
    const pairs = pairSideRows(rows).filter((r) => r.kind === "pair");
    expect(pairs).toHaveLength(2);
    expect(pairs[1]).toMatchObject({
      left: { text: "", tone: "blank" },
      right: { text: "added", tone: "add" },
    });
  });
});

describe("SideBySideDiff render", () => {
  it("shows Before/After columns with paired content", () => {
    const rendered = renderThemed(<SideBySideDiff diff={DIFF} />);
    const out = frameText(rendered.lastFrame);
    expect(out).toContain("Before");
    expect(out).toContain("After");
    expect(out).toContain("const oldName = 1;");
    expect(out).toContain("const newName = 1;");
    rendered.unmount();
  });
});
