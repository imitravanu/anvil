import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { executeTool } from "../index.js";
import type { ToolContext } from "../types.js";
import * as editFileTool from "../editFile.js";
import { MAX_WRITE_BYTES } from "../writeFile.js";

let root: string;
let ctx: ToolContext;
const never = new AbortController().signal;

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "anvil-edit-"));
  ctx = { projectRoot: root, signal: never };
  await fs.writeFile(path.join(root, "poem.txt"), "alpha\nbeta\ngamma\n");
});
afterAll(() => fs.rm(root, { recursive: true, force: true }));

describe("edit_file", () => {
  it("replaces a unique occurrence and its summary is a real unified diff", async () => {
    const result = await executeTool(
      "edit_file",
      { path: "poem.txt", old_str: "beta", new_str: "BETA" },
      ctx
    );
    expect(result.isError).toBe(false);
    // A unified diff, not a plain-English description:
    expect(result.summary).toMatch(/^--- a\//m);
    expect(result.summary).toMatch(/^\+\+\+ b\//m);
    expect(result.summary).toContain("-beta");
    expect(result.summary).toContain("+BETA");
    const content = await fs.readFile(path.join(root, "poem.txt"), "utf8");
    expect(content).toBe("alpha\nBETA\ngamma\n");
  });

  it("fails when old_str is not found", async () => {
    const result = await executeTool(
      "edit_file",
      { path: "poem.txt", old_str: "delta", new_str: "x" },
      ctx
    );
    expect(result.isError).toBe(true);
    expect((result.output as { error: string }).error).toContain("not found");
  });

  it("fails when old_str matches more than once", async () => {
    await fs.writeFile(path.join(root, "dupe.txt"), "same\nsame\n");
    const result = await executeTool(
      "edit_file",
      { path: "dupe.txt", old_str: "same", new_str: "x" },
      ctx
    );
    expect(result.isError).toBe(true);
    expect((result.output as { error: string }).error).toContain("2 times");
    // and the file is untouched
    await expect(fs.readFile(path.join(root, "dupe.txt"), "utf8")).resolves.toBe("same\nsame\n");
  });

  it("inserts new_str literally even when it contains $ sequences", async () => {
    await fs.writeFile(path.join(root, "dollar.txt"), "value: PLACEHOLDER\n");
    const result = await executeTool(
      "edit_file",
      { path: "dollar.txt", old_str: "PLACEHOLDER", new_str: "$& $1 $$" },
      ctx
    );
    expect(result.isError).toBe(false);
    await expect(fs.readFile(path.join(root, "dollar.txt"), "utf8")).resolves.toBe(
      "value: $& $1 $$\n"
    );
  });

  it("describe() returns the real diff without writing", async () => {
    const preview = await editFileTool.describe(
      { path: "poem.txt", old_str: "gamma", new_str: "GAMMA" },
      ctx
    );
    expect(preview).toContain("-gamma");
    expect(preview).toContain("+GAMMA");
    await expect(fs.readFile(path.join(root, "poem.txt"), "utf8")).resolves.toBe(
      "alpha\nBETA\ngamma\n"
    );
  });

  it("describe() refuses multi-match instead of previewing a first-match diff", async () => {
    await fs.writeFile(path.join(root, "dup.txt"), "same\nsame\n");
    const preview = await editFileTool.describe(
      { path: "dup.txt", old_str: "same", new_str: "other" },
      ctx
    );
    expect(preview).toContain("preview unavailable");
    expect(preview).toContain("2 times");
    expect(preview).not.toContain("+++ b/");
  });

  it("refuses files over the size cap without reading them fully", async () => {
    const big = "z".repeat(MAX_WRITE_BYTES + 1024);
    await fs.writeFile(path.join(root, "big.txt"), big);
    const result = await executeTool(
      "edit_file",
      { path: "big.txt", old_str: "z", new_str: "y" },
      ctx
    );
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.output)).toContain("exceeds");
    // untouched
    await expect(fs.readFile(path.join(root, "big.txt"), "utf8")).resolves.toBe(big);
  });
});
