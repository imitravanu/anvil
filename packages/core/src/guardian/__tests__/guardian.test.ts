import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { scanTextForSlop, scanDiffForSlop } from "../scanner.js";
import { autoFixRawErrorFormat, guardianFixedText, interceptTurn } from "../interceptor.js";
import { guardedInit } from "../init.js";

// Fixture patterns are concatenated so this test source never contains a
// literal slop pattern (the gate scans added lines); runtime values are exact.
const FIX_AS_ANY = "const x = foo as " + "any;";
const FIX_RAW_ERROR = "const m = err instanceof " + "Error ? err.message : String(err);";
const FIX_EMPTY_CATCH = "try { run(); } catch " + "{}";

describe("scanTextForSlop", () => {
  it("flags as-any in production files", () => {
    const violations = scanTextForSlop("src/a.ts", FIX_AS_ANY);
    expect(violations.some((v) => v.rule === "no-as-any")).toBe(true);
  });

  it("ignores as-any in test fixtures", () => {
    const violations = scanTextForSlop("src/__tests__/a.test.ts", FIX_AS_ANY);
    expect(violations.some((v) => v.rule === "no-as-any")).toBe(false);
  });

  it("flags raw error formatting", () => {
    const violations = scanTextForSlop("src/a.ts", FIX_RAW_ERROR);
    expect(violations.some((v) => v.rule === "no-raw-error-format")).toBe(true);
  });

  it("flags empty catch blocks", () => {
    const violations = scanTextForSlop("src/a.ts", FIX_EMPTY_CATCH);
    expect(violations.some((v) => v.rule === "no-empty-catch")).toBe(true);
  });
});

describe("scanDiffForSlop", () => {
  it("scans added lines only", () => {
    const diff = "-const x = foo as " + "any;\n+const y = 1;\n";
    expect(scanDiffForSlop("src/a.ts", diff)).toEqual([]);
    const dirty = "+const x = foo as " + "any;\n";
    expect(scanDiffForSlop("src/a.ts", dirty).length).toBeGreaterThan(0);
  });
});

describe("autoFixRawErrorFormat", () => {
  it("rewrites the common ternary to getErrorMessage", () => {
    const fixed = autoFixRawErrorFormat(FIX_RAW_ERROR);
    expect(fixed).toBe("const m = getErrorMessage(err);");
  });
});

describe("interceptTurn", () => {
  it("allows clean turns", () => {
    const result = interceptTurn([{ path: "src/a.ts", diff: "+const y = 1;\n" }]);
    expect(result.allowed).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("auto-fixes raw error formatting", () => {
    const result = interceptTurn([{ path: "src/a.ts", diff: `+${FIX_RAW_ERROR}\n` }]);
    expect(result.allowed).toBe(true);
    expect(result.fixed).toHaveLength(1);
    expect(result.fixed[0].diff).toContain("getErrorMessage(err)");
  });

  it("blocks as-any for the model to repair", () => {
    const result = interceptTurn([{ path: "src/a.ts", diff: `+${FIX_AS_ANY}\n` }]);
    expect(result.allowed).toBe(false);
    expect(result.violations.some((v) => v.rule === "no-as-any")).toBe(true);
  });

  it("auto-fixes two distinct raw-error edits to the SAME path without cross-contamination", () => {
    const A = "const m = err instanceof " + "Error ? err.message : String(err);";
    const B = "const msg = e instanceof " + "Error ? e.message : String(e);";
    const result = interceptTurn([
      { path: "src/a.ts", diff: `+${A}\n` },
      { path: "src/a.ts", diff: `+${B}\n` },
    ]);
    expect(result.allowed).toBe(true);
    expect(result.fixed).toHaveLength(2);
    // Positional identity: each fixed entry must record WHICH pending change
    // it belongs to — a path key alone cannot distinguish same-path edits.
    expect(result.fixed.map((f) => f.index)).toEqual([0, 1]);
    expect(result.fixed[0].diff).toContain("getErrorMessage(err)");
    expect(result.fixed[1].diff).toContain("getErrorMessage(e)");
  });
});

describe("guardianFixedText", () => {
  it("strips diff markers from a repaired diff, preserving clean lines", () => {
    expect(guardianFixedText("+const m = getErrorMessage(err);\n+const y = 1;\n")).toBe(
      "const m = getErrorMessage(err);\nconst y = 1;\n",
    );
  });
});

describe("guardedInit", () => {
  let dir = "";
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-guarded-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("provisions AGENTS.md and allowlist without overwriting", () => {
    const first = guardedInit(dir, "typescript");
    expect(first.created).toContain("AGENTS.md");
    expect(first.created).toContain(".fresh-allowlist.json");
    const second = guardedInit(dir, "typescript");
    expect(second.skipped).toContain("AGENTS.md");
    expect(fs.readFileSync(path.join(dir, "AGENTS.md"), "utf8")).toContain("as " + "any");
  });
});
