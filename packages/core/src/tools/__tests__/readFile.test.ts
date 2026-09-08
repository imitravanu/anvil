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
  root = await fs.mkdtemp(path.join(os.tmpdir(), "anvil-read-"));
  ctx = { projectRoot: root, signal: never };
  await fs.writeFile(path.join(root, "sample.txt"), "one\ntwo\nthree\n");
});
afterAll(() => fs.rm(root, { recursive: true, force: true }));

describe("read_file", () => {
  it("reads a file with cat -n style line numbers", async () => {
    const result = await executeTool("read_file", { path: "sample.txt" }, ctx);
    expect(result.isError).toBe(false);
    const output = result.output as { content: string; totalBytes: number };
    expect(output.content).toContain("     1\tone");
    expect(output.content).toContain("     3\tthree");
    expect(output.totalBytes).toBe(14);
  });

  it("returns an error result for a missing file (not a throw)", async () => {
    const result = await executeTool("read_file", { path: "missing.txt" }, ctx);
    expect(result.isError).toBe(true);
    expect((result.output as { error: string }).error).toMatch(/ENOENT/);
  });

  it("refuses paths outside the project root", async () => {
    const result = await executeTool("read_file", { path: "../../../etc/passwd" }, ctx);
    expect(result.isError).toBe(true);
    expect((result.output as { error: string }).error).toMatch(/escapes project root/);
  });

  it("truncates a file larger than the read cap but reports its true size", async () => {
    // The cap is 512KB (not exported); write just past it so the truncated path
    // is exercised without allocating or transmitting the whole file.
    const cap = 512 * 1024;
    await fs.writeFile(path.join(root, "big.txt"), "x".repeat(cap + 64));
    const result = await executeTool("read_file", { path: "big.txt" }, ctx);
    expect(result.isError).toBe(false);
    const output = result.output as { content: string; totalBytes: number; truncated: boolean };
    // True byte count comes from stat, not from the bounded buffer.
    expect(output.totalBytes).toBe(cap + 64);
    expect(output.truncated).toBe(true);
    // The echoed content is bounded to the cap — the file tail is never buffered.
    expect(output.content.length).toBeLessThan(cap + 64);
    expect(result.summary).toContain(", truncated");
  });
});
