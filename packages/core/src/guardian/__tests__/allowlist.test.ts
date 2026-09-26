import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadFreshAllowlist } from "../allowlist.js";

let dir = "";

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-allowlist-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("loadFreshAllowlist", () => {
  it("reports not-present for a missing file", () => {
    expect(loadFreshAllowlist(dir).present).toBe(false);
  });

  it("reads valid entries", () => {
    fs.writeFileSync(
      path.join(dir, ".fresh-allowlist.json"),
      JSON.stringify({ version: 1, entries: [{ file: "packages/core/src/x.ts", reason: "legacy debt" }] })
    );
    const al = loadFreshAllowlist(dir);
    expect(al.present).toBe(true);
    expect(al.version).toBe(1);
    expect(al.entries).toEqual([{ file: "packages/core/src/x.ts", reason: "legacy debt" }]);
    expect(al.rejected).toBe(0);
  });

  it("rejects broad and malformed entries without half-loading", () => {
    fs.writeFileSync(
      path.join(dir, ".fresh-allowlist.json"),
      JSON.stringify({
        version: 1,
        entries: [
          { file: "packages", reason: "too broad" },
          { file: "packages/core/src/ok.ts", reason: "ok reason" },
          { nope: true },
        ],
      })
    );
    const al = loadFreshAllowlist(dir);
    expect(al.entries).toEqual([{ file: "packages/core/src/ok.ts", reason: "ok reason" }]);
    expect(al.rejected).toBe(2);
  });

  // AUDIT-05: the shape rule is "a repo-relative source file path", not
  // "packages/<pkg>/src/*" — a foreign repo provisioned by anvil init --guarded
  // lays its sources out as src/..., and its legitimate entries were previously
  // counted rejected here (and hard-failed the repo gate).
  it("accepts foreign-repo (non-monorepo) source paths", () => {
    fs.writeFileSync(
      path.join(dir, ".fresh-allowlist.json"),
      JSON.stringify({
        version: 1,
        entries: [
          { file: "src/legacy.ts", reason: "pre-existing debt" },
          { file: "app/page.tsx", reason: "framework default" },
        ],
      })
    );
    const al = loadFreshAllowlist(dir);
    expect(al.rejected).toBe(0);
    expect(al.entries).toHaveLength(2);
  });

  it("rejects directories, globs, absolute paths, traversal, and non-source files", () => {
    fs.writeFileSync(
      path.join(dir, ".fresh-allowlist.json"),
      JSON.stringify({
        version: 1,
        entries: [
          { file: "packages/core/src", reason: "directory, not a file" },
          { file: "packages/core/src/", reason: "trailing slash" },
          { file: "packages/core/src/*.ts", reason: "glob" },
          { file: "/etc/passwd.ts", reason: "absolute path" },
          { file: "../outside/escape.ts", reason: "traversal" },
          { file: "packages/core/src/./x.ts", reason: "dot segment" },
          { file: "README.md", reason: "not source code" },
          { file: "lib/util.py", reason: "outside the JS/TS scan surface" },
          { file: "src/legacy.ts", reason: "acceptable entry" },
        ],
      })
    );
    const al = loadFreshAllowlist(dir);
    expect(al.entries).toEqual([{ file: "src/legacy.ts", reason: "acceptable entry" }]);
    expect(al.rejected).toBe(8);
  });

  it("reports not-present on invalid JSON", () => {
    fs.writeFileSync(path.join(dir, ".fresh-allowlist.json"), "{not json");
    expect(loadFreshAllowlist(dir).present).toBe(false);
  });
});
