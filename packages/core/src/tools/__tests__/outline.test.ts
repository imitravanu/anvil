import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  definition,
  execute,
  extractSymbols,
} from "../outline.js";

describe("extractSymbols", () => {
  it("extracts TypeScript / JavaScript symbols", () => {
    const code = `
export interface UserConfig {
  id: string;
}

export type Status = "active" | "inactive";

export enum Role {
  Admin,
  User,
}

export class Engine {
  start() {}
}

export async function runTask(timeout: number): Promise<void> {
  // body
}

const compute = (a: number) => a * 2;
export const helper = (b: string) => b.trim();
`;
    const symbols = extractSymbols(code, ".ts");
    const names = symbols.map((s) => s.name);
    expect(names).toContain("UserConfig");
    expect(names).toContain("Status");
    expect(names).toContain("Role");
    expect(names).toContain("Engine");
    expect(names).toContain("runTask");
    expect(names).toContain("helper");

    const iface = symbols.find((s) => s.name === "UserConfig");
    expect(iface?.kind).toBe("interface");

    const cls = symbols.find((s) => s.name === "Engine");
    expect(cls?.kind).toBe("class");

    const fn = symbols.find((s) => s.name === "runTask");
    expect(fn?.kind).toBe("function");
  });

  it("extracts Python symbols", () => {
    const pyCode = `
class AgentRunner:
    def __init__(self):
        pass

def process_item(item):
    return item

async def fetch_data(url):
    pass
`;
    const symbols = extractSymbols(pyCode, ".py");
    const names = symbols.map((s) => s.name);
    expect(names).toContain("AgentRunner");
    expect(names).toContain("process_item");
    expect(names).toContain("fetch_data");

    const cls = symbols.find((s) => s.name === "AgentRunner");
    expect(cls?.kind).toBe("class");
  });

  it("extracts Go symbols", () => {
    const goCode = `
package main

type Config struct {
    Port int
}

type Service interface {
    Start()
}

func (c *Config) Validate() error {
    return nil
}

func StartServer() {
}
`;
    const symbols = extractSymbols(goCode, ".go");
    const names = symbols.map((s) => s.name);
    expect(names).toContain("Config");
    expect(names).toContain("Service");
    expect(names).toContain("Validate");
    expect(names).toContain("StartServer");
  });

  it("extracts Markdown headings", () => {
    const md = `
# Title
Intro text

## Section 1
More text

### Details
`;
    const symbols = extractSymbols(md, ".md");
    expect(symbols.length).toBe(3);
    expect(symbols[0].name).toBe("Title");
    expect(symbols[1].name).toBe("Section 1");
    expect(symbols[2].name).toBe("Details");
  });
});

describe("get_outline tool executor", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-outline-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("has non-mutating tool definition", () => {
    expect(definition.name).toBe("get_outline");
    expect(definition.mutating).toBe(false);
  });

  it("rejects path escaping project root", async () => {
    const result = await execute({ path: "../../../etc" }, {
      projectRoot: tmpDir,
      signal: new AbortController().signal,
    });
    expect(result.isError).toBe(true);
    expect(result.summary).toContain("escapes project root");
  });

  it("scans a single source file", async () => {
    const filePath = path.join(tmpDir, "index.ts");
    fs.writeFileSync(filePath, "export function hello() {}\nexport class App {}", "utf8");

    const result = await execute({ path: "index.ts" }, {
      projectRoot: tmpDir,
      signal: new AbortController().signal,
    });

    expect(result.isError).toBe(false);
    const output = result.output as any;
    expect(output.totalFilesScanned).toBe(1);
    expect(output.totalSymbolsFound).toBe(2);
    expect(output.outlines[0].path).toBe("index.ts");
    expect(output.outlines[0].symbols.map((s: any) => s.name)).toEqual(["hello", "App"]);
  });

  it("walks directory and ignores node_modules and .git", async () => {
    const srcDir = path.join(tmpDir, "src");
    const nodeModules = path.join(tmpDir, "node_modules", "lib");
    fs.mkdirSync(srcDir, { recursive: true });
    fs.mkdirSync(nodeModules, { recursive: true });

    fs.writeFileSync(path.join(srcDir, "util.ts"), "export function format() {}", "utf8");
    fs.writeFileSync(path.join(nodeModules, "vendor.ts"), "export function vendor() {}", "utf8");

    const result = await execute({}, {
      projectRoot: tmpDir,
      signal: new AbortController().signal,
    });

    expect(result.isError).toBe(false);
    const output = result.output as any;
    const paths = output.outlines.map((o: any) => o.path);
    expect(paths).toContain("src/util.ts");
    expect(paths.some((p: string) => p.includes("node_modules"))).toBe(false);
  });
});
