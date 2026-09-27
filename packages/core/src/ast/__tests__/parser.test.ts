import { describe, expect, it } from "vitest";
import { parseFileAst, detectLanguage } from "../parser.js";
import { generateSkeleton } from "../folder.js";

describe("detectLanguage", () => {
  it("maps extensions accurately", () => {
    expect(detectLanguage("src/index.ts")).toBe("typescript");
    expect(detectLanguage("components/App.tsx")).toBe("typescript");
    expect(detectLanguage("util.js")).toBe("javascript");
    expect(detectLanguage("script.py")).toBe("python");
    expect(detectLanguage("main.rs")).toBe("rust");
    expect(detectLanguage("server.go")).toBe("go");
    expect(detectLanguage("README.md")).toBe("unknown");
  });
});

describe("parseFileAst - TypeScript", () => {
  const tsCode = `
/**
 * User configuration options.
 */
export interface UserConfig {
  id: string;
  name: string;
  active?: boolean;
}

export type Role = "admin" | "member" | "guest";

export enum Status {
  Active = 1,
  Suspended = 2,
}

export class UserManager {
  private users: Map<string, UserConfig> = new Map();

  /**
   * Register a new user.
   */
  public register(config: UserConfig): boolean {
    const existing = this.users.get(config.id);
    if (existing) {
      return false;
    }
    this.users.set(config.id, config);
    return true;
  }

  public get(id: string): UserConfig | undefined {
    return this.users.get(id);
  }
}

export async function authenticate(token: string): Promise<boolean> {
  const isValid = token.length > 10;
  if (!isValid) {
    return false;
  }
  return true;
}

export const helper = (x: number) => {
  const res = x * 2;
  return res;
};

export const DEFAULT_TIMEOUT = 5000;
`;

  it("extracts interface, type, enum, class, methods, and functions", () => {
    const ast = parseFileAst(tsCode, "user.ts");
    expect(ast.language).toBe("typescript");
    expect(ast.symbols.length).toBeGreaterThanOrEqual(6);

    const iface = ast.symbols.find((s) => s.name === "UserConfig");
    expect(iface).toBeDefined();
    expect(iface?.kind).toBe("interface");
    expect(iface?.isExported).toBe(true);
    expect(iface?.docstring).toContain("User configuration options.");

    const typeSym = ast.symbols.find((s) => s.name === "Role");
    expect(typeSym).toBeDefined();
    expect(typeSym?.kind).toBe("type");

    const enumSym = ast.symbols.find((s) => s.name === "Status");
    expect(enumSym).toBeDefined();
    expect(enumSym?.kind).toBe("enum");

    const cls = ast.symbols.find((s) => s.name === "UserManager");
    expect(cls).toBeDefined();
    expect(cls?.kind).toBe("class");
    expect(cls?.children?.length).toBe(2);
    expect(cls?.children?.[0].name).toBe("register");
    expect(cls?.children?.[0].kind).toBe("method");
    expect(cls?.children?.[0].docstring).toContain("Register a new user.");

    const fn = ast.symbols.find((s) => s.name === "authenticate");
    expect(fn).toBeDefined();
    expect(fn?.kind).toBe("function");

    const arrow = ast.symbols.find((s) => s.name === "helper");
    expect(arrow).toBeDefined();
    expect(arrow?.kind).toBe("function");

    const constant = ast.symbols.find((s) => s.name === "DEFAULT_TIMEOUT");
    expect(constant).toBeDefined();
    expect(constant?.kind).toBe("constant");
  });
});

describe("parseFileAst - Python", () => {
  const pyCode = `
class Calculator:
    def __init__(self, base: int):
        self.base = base

    def add(self, x: int) -> int:
        result = self.base + x
        return result

def standalone_func(val: str):
    print("hello", val)
    return val.upper()
`;

  it("extracts python class, methods, and standalone functions", () => {
    const ast = parseFileAst(pyCode, "calc.py");
    expect(ast.language).toBe("python");

    const cls = ast.symbols.find((s) => s.name === "Calculator");
    expect(cls).toBeDefined();
    expect(cls?.kind).toBe("class");
    expect(cls?.children?.length).toBe(2);
    expect(cls?.children?.[0].name).toBe("__init__");
    expect(cls?.children?.[1].name).toBe("add");

    const fn = ast.symbols.find((s) => s.name === "standalone_func");
    expect(fn).toBeDefined();
    expect(fn?.kind).toBe("function");
  });
});

describe("parseFileAst - Rust", () => {
  const rsCode = `
pub struct Config {
    pub port: u16,
}

pub trait Service {
    fn run(&self);
}

pub fn start_server(cfg: Config) {
    let _ = cfg.port;
    println!("server started");
}
`;

  it("extracts rust struct, trait, and pub fn", () => {
    const ast = parseFileAst(rsCode, "server.rs");
    expect(ast.language).toBe("rust");

    const st = ast.symbols.find((s) => s.name === "Config");
    expect(st).toBeDefined();
    expect(st?.kind).toBe("struct");
    expect(st?.isExported).toBe(true);

    const tr = ast.symbols.find((s) => s.name === "Service");
    expect(tr).toBeDefined();
    expect(tr?.kind).toBe("trait");

    const fn = ast.symbols.find((s) => s.name === "start_server");
    expect(fn).toBeDefined();
    expect(fn?.kind).toBe("function");
    expect(fn?.isExported).toBe(true);
  });
});

describe("generateSkeleton", () => {
  const longModule = `
export interface Worker {
  id: string;
  start(): void;
}

export class TaskRunner {
  private queue: string[] = [];

  public async runBatch(tasks: string[]): Promise<number> {
    let completed = 0;
    for (const t of tasks) {
      const formatted = t.trim();
      if (!formatted) continue;
      this.queue.push(formatted);
      await new Promise((r) => setTimeout(r, 10));
      completed++;
    }
    return completed;
  }

  public clear(): void {
    this.queue = [];
  }
}

export function executeLongOperation(input: string): string {
  const step1 = input.toLowerCase();
  const step2 = step1.replace(/\\s+/g, "-");
  const step3 = step2.trim();
  const step4 = step3 + "-v1";
  const step5 = step4.toUpperCase();
  return step5;
}
`;

  it("folds function and method bodies exceeding threshold while preserving signatures and interfaces", () => {
    const skeleton = generateSkeleton(longModule, "worker.ts", { minLinesToFold: 4 });

    // The interface must remain fully visible
    expect(skeleton).toContain("export interface Worker {");
    expect(skeleton).toContain("start(): void;");

    // Class header and method signatures must remain visible
    expect(skeleton).toContain("export class TaskRunner {");
    expect(skeleton).toContain("public async runBatch(tasks: string[]): Promise<number> {");

    // The long body of runBatch must be folded
    expect(skeleton).toContain("/* ... ");
    expect(skeleton).toContain("lines folded (L");

    // Short methods under minLines should stay intact
    expect(skeleton).toContain("this.queue = [];");

    // executeLongOperation body must be folded
    expect(skeleton).toContain("export function executeLongOperation(input: string): string {");
  });

  it("folds Python methods with python comment style", () => {
    const pyCode = `
class Service:
    def process_large_data(self, data: list):
        filtered = []
        for x in data:
            if x > 0:
                filtered.append(x * 2)
        total = sum(filtered)
        return total
`;
    const skeleton = generateSkeleton(pyCode, "service.py", { minLinesToFold: 4 });
    expect(skeleton).toContain("class Service:");
    expect(skeleton).toContain("def process_large_data(self, data: list):");
    expect(skeleton).toContain("# ... ");
    expect(skeleton).toContain("lines folded");
  });
});
