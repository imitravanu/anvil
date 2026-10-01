import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { executeTool } from "../index.js";
import { MAX_FILES } from "../listFiles.js";
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
    expect(result.output).toEqual({ files: ["src/a.ts", "src/sub/b.ts"], count: 2, pattern: "src/**/*.ts" });
  });

  it("treats a plain (non-glob) pattern as a case-insensitive path substring", async () => {
    const byStem = await executeTool("list_files", { pattern: "a.ts" }, ctx);
    expect(byStem.output).toEqual({ files: ["src/a.ts"], count: 1, pattern: "a.ts" });

    const byDirName = await executeTool("list_files", { pattern: "SUB" }, ctx);
    expect(byDirName.output).toEqual({ files: ["src/sub/b.ts"], count: 1, pattern: "SUB" });

    // Bare file name without extension — the exact failure mode models hit.
    const byBareName = await executeTool("list_files", { pattern: "readme" }, ctx);
    expect(byBareName.output).toEqual({ files: ["README.md"], count: 1, pattern: "readme" });
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

// E9 (AUDIT-2026-09-30): `truncated` was `all.length >= MAX_FILES`, which is
// true when the project holds EXACTLY MAX_FILES files and nothing was dropped.
// Only an early-stopped walk may claim truncation.
describe("truncation honesty (E9)", () => {
  it("reports truncated only when files were actually dropped", async () => {
    const big = await fs.mkdtemp(path.join(os.tmpdir(), "anvil-list-cap-"));
    try {
      // Batched writes: MAX_FILES+1 open handles at once can exhaust fds.
      const BATCH = 500;
      for (let base = 0; base < MAX_FILES + 1; base += BATCH) {
        await Promise.all(
          Array.from({ length: Math.min(BATCH, MAX_FILES + 1 - base) }, (_, i) =>
            fs.writeFile(path.join(big, `f${base + i}.txt`), "x")
          )
        );
      }
      const bigCtx: ToolContext = { projectRoot: big, signal: never };

      const over = await executeTool("list_files", {}, bigCtx);
      expect(over.output).toMatchObject({ count: MAX_FILES, truncated: true });

      // Exactly at the cap with nothing dropped: no truncation claim.
      await fs.rm(path.join(big, `f${MAX_FILES}.txt`));
      const exact = await executeTool("list_files", {}, bigCtx);
      expect(exact.output).toEqual({ files: expect.any(Array), count: MAX_FILES });
    } finally {
      await fs.rm(big, { recursive: true, force: true });
    }
  }, 120_000);
});
