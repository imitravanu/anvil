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
  root = await fs.mkdtemp(path.join(os.tmpdir(), "anvil-list-"));
  ctx = { projectRoot: root, signal: never };
  for (const rel of [
    "src/a.ts",
    "src/sub/b.ts",
    "README.md",
    "node_modules/pkg/index.js",
    "dist/bundle.js",
  ]) {
    await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
    await fs.writeFile(path.join(root, rel), "x");
  }
});
afterAll(() => fs.rm(root, { recursive: true, force: true }));

describe("list_files", () => {
  it("lists files excluding node_modules/.git/dist", async () => {
    const result = await executeTool("list_files", {}, ctx);
    expect(result.isError).toBe(false);
    expect(result.output).toEqual({ files: ["README.md", "src/a.ts", "src/sub/b.ts"], count: 3 });
  });

  it("filters with a glob pattern", async () => {
    const result = await executeTool("list_files", { pattern: "src/**/*.ts" }, ctx);
    expect(result.output).toEqual({ files: ["src/a.ts", "src/sub/b.ts"], count: 2 });
  });

  it("can list a subdirectory only", async () => {
    const result = await executeTool("list_files", { path: "src" }, ctx);
    expect(result.output).toEqual({ files: ["src/a.ts", "src/sub/b.ts"], count: 2 });
  });

  it("refuses paths outside the project root", async () => {
    const result = await executeTool("list_files", { path: ".." }, ctx);
    expect(result.isError).toBe(true);
  });
});
