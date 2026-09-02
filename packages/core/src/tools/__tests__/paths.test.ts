import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PathEscapeError, resolveWithinRoot } from "../paths.js";

const ROOT = path.resolve("/tmp/anvil-project");
let symlinkRoot: string;
let outside: string;

beforeAll(async () => {
  symlinkRoot = await fs.mkdtemp(path.join(os.tmpdir(), "anvil-paths-"));
  outside = await fs.mkdtemp(path.join(os.tmpdir(), "anvil-outside-"));
  await fs.symlink(outside, path.join(symlinkRoot, "escape"));
});
afterAll(() => fs.rm(symlinkRoot, { recursive: true, force: true }));
afterAll(() => fs.rm(outside, { recursive: true, force: true }));

describe("resolveWithinRoot", () => {
  it.each([
    "../secret",
    "../../etc/x",
    "/etc/passwd",
    "./a/../../b",
    "a/../../../x",
    "src/../../../../home/user/.ssh/authorized_keys",
  ])("throws PathEscapeError for %s", (attempted) => {
    expect(() => resolveWithinRoot(ROOT, attempted)).toThrow(PathEscapeError);
  });

  it.each([
    "src/index.ts",
    "./src/index.ts",
    "a/../b",
    ".",
    "deep/nested/dir/file.txt",
    "src/../package.json",
  ])("resolves %s normally inside the root", (requested) => {
    const resolved = resolveWithinRoot(ROOT, requested);
    expect(resolved.startsWith(ROOT + path.sep) || resolved === ROOT).toBe(true);
  });

  it("resolving the root itself is allowed", () => {
    expect(resolveWithinRoot(ROOT, ".")).toBe(ROOT);
  });

  it("rejects paths through symlinks that point outside the project", () => {
    expect(() => resolveWithinRoot(symlinkRoot, "escape/secret.txt")).toThrow(PathEscapeError);
  });
});
