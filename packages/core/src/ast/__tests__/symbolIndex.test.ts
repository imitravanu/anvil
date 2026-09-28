import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WorkspaceSymbolIndex } from "../symbolIndex.js";

const AUTH = `
export interface AuthService {
  login(token: string): boolean;
}

export class DefaultAuthService implements AuthService {
  public login(token: string): boolean {
    return token === "secret";
  }
}
`;

const METRICS = `
export function computeMetrics(data: number[]): number {
  return data.reduce((a, b) => a + b, 0);
}

export const API_VERSION = "v1.4.0";
`;

function indexWith(files: [string, string][]): WorkspaceSymbolIndex {
  const idx = new WorkspaceSymbolIndex("/repo");
  for (const [p, content] of files) idx.indexFile(p, content);
  return idx;
}

describe("WorkspaceSymbolIndex.findSymbol ranking", () => {
  it("ranks exact > prefix > substring", () => {
    const idx = indexWith([["auth.ts", AUTH]]);
    const names = idx.findSymbol("Auth").map((s) => s.name);
    // "AuthService" is a prefix match (score 1); "DefaultAuthService" is only a
    // substring match (score 2) — prefix must come first.
    expect(names).toEqual(["AuthService", "DefaultAuthService"]);
  });

  it("is deterministic regardless of indexing order", () => {
    const forward = indexWith([
      ["auth.ts", AUTH],
      ["metrics.ts", METRICS],
    ]);
    const reverse = indexWith([
      ["metrics.ts", METRICS],
      ["auth.ts", AUTH],
    ]);
    // Both files contain an "A"-prefixed... use a query matching both files.
    const a = forward.findSymbol("e").map((s) => `${s.path}:${s.name}`);
    const b = reverse.findSymbol("e").map((s) => `${s.path}:${s.name}`);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it("exact mode returns only the exact name", () => {
    const idx = indexWith([["auth.ts", AUTH]]);
    const names = idx.findSymbol("DefaultAuthService", { exact: true }).map((s) => s.name);
    expect(names).toEqual(["DefaultAuthService"]);
    expect(idx.findSymbol("Auth", { exact: true })).toEqual([]);
  });

  it("still honors kind, exportedOnly, and limit filters", () => {
    const idx = indexWith([["auth.ts", AUTH]]);
    expect(idx.findSymbol("Auth", { kind: "interface" }).map((s) => s.name)).toEqual(["AuthService"]);
    expect(idx.findSymbol("Auth", { exportedOnly: true }).length).toBe(2);
    expect(idx.findSymbol("Auth", { limit: 1 }).length).toBe(1);
  });

  it("returns nothing for an empty query", () => {
    const idx = indexWith([["auth.ts", AUTH]]);
    expect(idx.findSymbol("   ")).toEqual([]);
  });
});

describe("WorkspaceSymbolIndex freshness (external edits)", () => {
  it("drops a symbol whose file was externally deleted", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "anvil-fresh-"));
    try {
      await fs.writeFile(path.join(dir, "a.ts"), "export function alpha() {}\n");
      await fs.writeFile(path.join(dir, "extra.ts"), "export function gamma() {}\n");
      const idx = new WorkspaceSymbolIndex(dir);
      await idx.buildIndex();
      expect(idx.findSymbol("gamma", { exact: true })).toHaveLength(1);

      await fs.rm(path.join(dir, "extra.ts"));
      await idx.validateFreshness();
      expect(idx.findSymbol("gamma", { exact: true })).toEqual([]);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("repairs a ghost and a confidently-empty result after an external rewrite", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "anvil-fresh-"));
    try {
      await fs.writeFile(path.join(dir, "calc.ts"), "export function alpha() { return 1; }\n");
      const idx = new WorkspaceSymbolIndex(dir);
      await idx.buildIndex();

      // External rewrite — as an editor save or `git checkout` performs it.
      await fs.writeFile(path.join(dir, "calc.ts"), "export function beta() { return 2; }\n");
      // A same-millisecond rewrite can collide with the recorded mtime; force
      // a strictly newer mtime so the test tests drift, not the clock.
      const st = await fs.stat(path.join(dir, "calc.ts"));
      await fs.utimes(path.join(dir, "calc.ts"), st.atime, new Date(st.mtimeMs + 5));

      await idx.validateFreshness();
      expect(idx.findSymbol("alpha", { exact: true })).toEqual([]);
      expect(idx.findSymbol("beta", { exact: true })).toHaveLength(1);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("does not re-read files that have not changed", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "anvil-fresh-"));
    try {
      await fs.writeFile(path.join(dir, "a.ts"), "export function alpha() {}\n");
      const idx = new WorkspaceSymbolIndex(dir);
      await idx.buildIndex();

      const first = await idx.validateFreshness();
      const second = await idx.validateFreshness();
      // Two validations over one unchanged file: nothing re-parsed, nothing removed.
      expect(first.reindexed).toBe(0);
      expect(first.removed).toBe(0);
      expect(second.reindexed).toBe(0);
      expect(second.removed).toBe(0);
      // And the lookup still works.
      expect(idx.findSymbol("alpha", { exact: true })).toHaveLength(1);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("WorkspaceSymbolIndex path normalization", () => {
  it("treats backslash and forward-slash paths as the same file", () => {
    const idx = new WorkspaceSymbolIndex("/repo");
    idx.indexFile("src\\mod.ts", AUTH);
    idx.indexFile("src/mod.ts", AUTH);
    // One file, not two: the second index must have replaced the first.
    expect(idx.findSymbol("AuthService", { exact: true })).toHaveLength(1);
  });

  it("treats ./src and src as the same file", () => {
    const idx = new WorkspaceSymbolIndex("/repo");
    idx.indexFile("./src/mod.ts", AUTH);
    idx.indexFile("src/mod.ts", AUTH);
    expect(idx.findSymbol("AuthService", { exact: true })).toHaveLength(1);
  });

  it("removeFile removes by any separator spelling", () => {
    const idx = new WorkspaceSymbolIndex("/repo");
    idx.indexFile("src/mod.ts", AUTH);
    idx.removeFile("src\\mod.ts");
    expect(idx.findSymbol("AuthService", { exact: true })).toEqual([]);
  });

  it("reports indexed paths in canonical forward-slash form", () => {
    const idx = new WorkspaceSymbolIndex("/repo");
    idx.indexFile("src\\mod.ts", AUTH);
    expect(idx.findSymbol("AuthService", { exact: true })[0].path).toBe("src/mod.ts");
  });
});
