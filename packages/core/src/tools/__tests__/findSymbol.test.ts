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
  root = await fs.mkdtemp(path.join(os.tmpdir(), "anvil-sym-"));
  ctx = { projectRoot: root, signal: never };

  const code1 = `
export interface AuthService {
  login(token: string): boolean;
}

export class DefaultAuthService implements AuthService {
  public login(token: string): boolean {
    return token === "secret";
  }
}
`;

  const code2 = `
export function computeMetrics(data: number[]): number {
  return data.reduce((a, b) => a + b, 0);
}

export const API_VERSION = "v1.4.0";
`;

  await fs.writeFile(path.join(root, "auth.ts"), code1);
  await fs.writeFile(path.join(root, "metrics.ts"), code2);
});

afterAll(() => fs.rm(root, { recursive: true, force: true }));

describe("find_symbol", () => {
  it("finds symbols by substring across workspace files", async () => {
    const result = await executeTool("find_symbol", { query: "Auth" }, ctx);
    expect(result.isError).toBe(false);
    const output = result.output as {
      count: number;
      symbols: { name: string; kind: string; path: string; line: number }[];
    };
    expect(output.count).toBeGreaterThanOrEqual(2);
    expect(output.symbols.some((s) => s.name === "AuthService" && s.kind === "interface")).toBe(true);
    expect(output.symbols.some((s) => s.name === "DefaultAuthService" && s.kind === "class")).toBe(true);
  });

  it("filters symbols by kind", async () => {
    const result = await executeTool("find_symbol", { query: "Auth", kind: "interface" }, ctx);
    expect(result.isError).toBe(false);
    const output = result.output as {
      count: number;
      symbols: { name: string; kind: string }[];
    };
    expect(output.symbols.every((s) => s.kind === "interface")).toBe(true);
    expect(output.symbols[0].name).toBe("AuthService");
  });

  it("finds exported functions and constants", async () => {
    const result = await executeTool("find_symbol", { query: "computeMetrics" }, ctx);
    expect(result.isError).toBe(false);
    const output = result.output as {
      count: number;
      symbols: { name: string; kind: string }[];
    };
    expect(output.count).toBe(1);
    expect(output.symbols[0].name).toBe("computeMetrics");
    expect(output.symbols[0].kind).toBe("function");
  });

  it("returns error on missing query", async () => {
    const result = await executeTool("find_symbol", {}, ctx);
    expect(result.isError).toBe(true);
  });
});
