import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { definition, execute } from "../updateMemory.js";
import { loadProjectMemory } from "../../config/memory.js";
import type { ToolContext } from "../types.js";

let tmpDir: string;
let ctx: ToolContext;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-tool-mem-"));
  ctx = { projectRoot: tmpDir, signal: new AbortController().signal };
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("update_memory tool", () => {
  it("has correct tool definition properties", () => {
    expect(definition.name).toBe("update_memory");
    expect(definition.mutating).toBe(false);
    expect(definition.inputSchema.required).toContain("entry");
  });

  it("fails if entry is missing or empty", async () => {
    const r1 = await execute({}, ctx);
    expect(r1.isError).toBe(true);

    const r2 = await execute({ entry: "   " }, ctx);
    expect(r2.isError).toBe(true);
  });

  it("appends entry to .anvil/memory.md and auto-creates .gitignore", async () => {
    const res = await execute(
      { entry: "Key finding: Service X handles rate-limiting with 429 Retry-After" },
      ctx
    );

    expect(res.isError).toBeFalsy();
    expect(res.summary).toContain("Recorded note in project memory");

    const mem = loadProjectMemory(tmpDir);
    expect(mem).not.toBeNull();
    expect(mem?.content).toContain("Service X handles rate-limiting");

    const gitignore = path.join(tmpDir, ".anvil", ".gitignore");
    expect(fs.existsSync(gitignore)).toBe(true);
    expect(fs.readFileSync(gitignore, "utf8")).toContain("memory.md");
  });
});
