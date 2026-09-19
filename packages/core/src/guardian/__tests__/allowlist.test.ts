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

  it("reports not-present on invalid JSON", () => {
    fs.writeFileSync(path.join(dir, ".fresh-allowlist.json"), "{not json");
    expect(loadFreshAllowlist(dir).present).toBe(false);
  });
});
