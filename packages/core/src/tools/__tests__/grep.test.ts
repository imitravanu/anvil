import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { executeTool } from "../index.js";
import type { ToolContext } from "../types.js";

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
});
