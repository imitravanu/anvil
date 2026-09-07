import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { executeTool } from "../index.js";
import type { ToolContext } from "../types.js";
import { grepPatternError, GREP_PATTERN_MAX_LENGTH, GREP_LINE_TEST_MAX } from "../grep.js";

let root: string;
let ctx: ToolContext;
const never = new AbortController().signal;

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "anvil-grep-"));
  ctx = { projectRoot: root, signal: never };
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.writeFile(path.join(root, "src/a.ts"), "const foo = 1;\nconst bar = 2;\n");
  await fs.writeFile(path.join(root, "src/b.ts"), "export const foo = 3;\n");
  await fs.writeFile(path.join(root, "skipme.log"), "foo here\n");
});
afterAll(() => fs.rm(root, { recursive: true, force: true }));

describe("grep", () => {
  it("finds regex matches across files with path and line numbers", async () => {
    const result = await executeTool("grep", { pattern: "foo" }, ctx);
    expect(result.isError).toBe(false);
    const { matches } = result.output as { matches: Array<{ path: string; line: number }> };
    expect(matches).toEqual([
      { path: "skipme.log", line: 1, text: "foo here" },
      { path: "src/a.ts", line: 1, text: "const foo = 1;" },
      { path: "src/b.ts", line: 1, text: "export const foo = 3;" },
    ]);
  });

  it("limits the search to a subdirectory", async () => {
    const result = await executeTool("grep", { pattern: "foo", path: "src" }, ctx);
    const { matches } = result.output as { matches: unknown[] };
    expect(matches).toHaveLength(2);
  });

  it("reports an error result for an invalid regex", async () => {
    const result = await executeTool("grep", { pattern: "([unclosed" }, ctx);
    expect(result.isError).toBe(true);
    expect((result.output as { error: string }).error).toContain("Invalid regular expression");
  });

  it("rejects catastrophic backtracking shapes before they can hang the scan", async () => {
    // (a|aa)+$ hangs Node for >6s on a 38-char line (verified) — and the
    // engine is synchronous, so no cancellation can interrupt it.
    const result = await executeTool("grep", { pattern: "(a|aa)+$" }, ctx);
    expect(result.isError).toBe(true);
    expect((result.output as { error: string }).error).toContain("Unsafe pattern");
  });

  it("rejects nested-quantifier and alternation-in-repeated-group shapes", () => {
    for (const bad of [
      "(a+)+",
      "(a*)*",
      "(?:foo|bar)+",
      "(a{1,3})*",
      "(?:(?:ab)+)+",
      "(a|aa)+$",
      "(ab|cd)*",
      "((?:x|y){2,})+",
    ]) {
      expect(grepPatternError(bad), `should reject ${bad}`).not.toBeNull();
    }
  });

  it("allows legitimate fixed-text repeats, plain alternation, and simple patterns", () => {
    for (const good of [
      "(?:ab)+", // fixed text repeated — linear, no backtracking bomb
      "(?:ab{2})+", // exact-inner quantifier folds to a fixed string — still linear
      "foo|bar",
      "(foo|bar)", // alternation but NOT in a repeated group
      "const \\w+ =",
      "todo|fixme",
      "^export function",
      "(?:[a-z]+):",
      "(?<name>\\w+)\\s*=",
    ]) {
      expect(grepPatternError(good), `should allow ${good}`).toBeNull();
    }
  });

  it("enforces the pattern length cap and exposes bounds for the line test", () => {
    expect(grepPatternError("a".repeat(GREP_PATTERN_MAX_LENGTH + 1))).toContain("safety limit");
    expect(grepPatternError("")).toContain("empty");
    expect(Number.isInteger(GREP_LINE_TEST_MAX) && GREP_LINE_TEST_MAX > 0).toBe(true);
  });
});
