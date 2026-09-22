import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { captureFailureDiff } from "../failureDiff.js";
import { createEvalReport, formatEvalReport, saveEvalReport } from "../report.js";
import type { EvalResult } from "../types.js";

let dirs: string[] = [];

function mk(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-diff-"));
  dirs.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return dir;
}

afterEach(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

describe("captureFailureDiff (27.3)", () => {
  it("returns an empty string when nothing changed", () => {
    const before = mk({ "src/x.ts": "const a = 1;\n" });
    const after = mk({ "src/x.ts": "const a = 1;\n" });
    expect(captureFailureDiff(before, after)).toBe("");
  });

  it("diffs a modified file", () => {
    const before = mk({ "src/x.ts": "const a = 1;\n" });
    const after = mk({ "src/x.ts": "const a = 2;\n" });
    const d = captureFailureDiff(before, after);
    expect(d).toContain("--- a/src/x.ts");
    expect(d).toContain("+++ b/src/x.ts");
    expect(d).toContain("-const a = 1;");
    expect(d).toContain("+const a = 2;");
  });

  it("reports created and deleted files", () => {
    const before = mk({ "keep.ts": "keep\n", "gone.ts": "bye\n" });
    const after = mk({ "keep.ts": "keep\n", "new.ts": "hello\n" });
    const d = captureFailureDiff(before, after);
    expect(d).toContain("b/new.ts");
    expect(d).toContain("+hello");
    expect(d).toContain("a/gone.ts");
    expect(d).toContain("-bye");
  });

  it("caps the diff at maxChars", () => {
    const before = mk({ "big.txt": `${"a".repeat(50)}\n` });
    const after = mk({ "big.txt": `${"b".repeat(50)}\n` });
    const d = captureFailureDiff(before, after, 20);
    expect(d).toContain("[diff truncated");
    expect(d.length).toBeLessThan(120);
  });
});

describe("failure diff surfacing (27.3)", () => {
  function failed(): EvalResult {
    return {
      taskId: "t-fail",
      name: "Fail",
      category: "bugfix",
      passed: false,
      wallClockMs: 1,
      tokensUsed: { input: 1, output: 1 },
      toolCalls: 0,
      error: "check failed",
      failureDiff: "--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n-old\n+new\n",
    };
  }

  it("persists a failed task's diff under failures/", async () => {
    const out = mk({});
    await saveEvalReport(createEvalReport([failed()], "m", "p"), out);
    const runDir = fs.readdirSync(out).find((name) => fs.statSync(path.join(out, name)).isDirectory());
    expect(runDir).toBeDefined();
    const diffPath = path.join(out, runDir as string, "failures", "t-fail.diff");
    expect(fs.existsSync(diffPath)).toBe(true);
    expect(fs.readFileSync(diffPath, "utf8")).toContain("+new");
  });

  it("renders the failure diff snippet in the report", () => {
    const text = formatEvalReport(createEvalReport([failed()], "m", "p"));
    expect(text).toContain("@@ -1 +1 @@");
    expect(text).toContain("+new");
  });
});
