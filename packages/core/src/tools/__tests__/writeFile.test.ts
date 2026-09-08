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

  it("refuses content larger than the read-side safety limit", async () => {
    const result = await executeTool(
      "write_file",
      { path: "too-large.txt", content: "x".repeat(writeFileTool.MAX_WRITE_BYTES + 1) },
      ctx
    );
    expect(result.isError).toBe(true);
    expect(result.summary).toContain("exceeds");
    await expect(fs.access(path.join(root, "too-large.txt"))).rejects.toThrow();
  });

  it("preserves file mode bits across overwrites", async () => {
    const target = path.join(root, "run.sh");
    await fs.writeFile(target, "#!/bin/sh\necho hi\n");
    await fs.chmod(target, 0o755);
    const result = await executeTool("write_file", { path: "run.sh", content: "#!/bin/sh\necho yo\n" }, ctx);
    expect(result.isError).toBe(false);
    expect((await fs.stat(target)).mode & 0o777).toBe(0o755);
  });

  it("handles missing or malformed input without throwing TypeErrors", async () => {
    const result1 = await executeTool("write_file", {}, ctx);
    expect(result1.isError).toBe(true);
    expect(result1.summary).toContain("missing required arguments");

    const result2 = await executeTool("write_file", { path: 123 as any, content: "ok" }, ctx);
    expect(result2.isError).toBe(true);

    const preview = await writeFileTool.describe({}, ctx);
    expect(preview).toContain("missing path");
  });
});
