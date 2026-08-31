import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { executeTool } from "../index.js";
import type { ToolContext } from "../types.js";
import * as writeFileTool from "../writeFile.js";

let root: string;
let ctx: ToolContext;
const never = new AbortController().signal;

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "anvil-write-"));
  ctx = { projectRoot: root, signal: never };
});
afterAll(() => fs.rm(root, { recursive: true, force: true }));

describe("write_file", () => {
  it("writes a file and creates parent directories", async () => {
    const result = await executeTool(
      "write_file",
      { path: "src/deep/new.txt", content: "hello" },
      ctx
    );
    expect(result.isError).toBe(false);
    expect((result.output as { bytes: number }).bytes).toBe(5);
    await expect(fs.readFile(path.join(root, "src/deep/new.txt"), "utf8")).resolves.toBe("hello");
  });

  it("reports overwriting vs creating", async () => {
    const again = await executeTool("write_file", { path: "src/deep/new.txt", content: "hello!!" }, ctx);
    expect((again.output as { overwrote: boolean }).overwrote).toBe(true);
    expect(again.summary).toContain("Overwrote");
  });

  it("describe() previews without writing", async () => {
    const preview = await writeFileTool.describe({ path: "src/preview.txt", content: "abc" }, ctx);
    expect(preview).toContain("Create src/preview.txt (3 bytes)");
    await expect(fs.access(path.join(root, "src/preview.txt"))).rejects.toThrow();
  });

  it("refuses paths outside the project root", async () => {
    const result = await executeTool("write_file", { path: "../evil.txt", content: "x" }, ctx);
    expect(result.isError).toBe(true);
    expect((result.output as { error: string }).error).toMatch(/escapes project root/);
  });
});
