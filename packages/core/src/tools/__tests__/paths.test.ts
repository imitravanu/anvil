import { describe, expect, it } from "vitest";
import path from "node:path";
import { PathEscapeError, resolveWithinRoot } from "../paths.js";

const ROOT = path.resolve("/tmp/anvil-project");

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
});
