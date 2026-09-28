import { describe, expect, it } from "vitest";
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
