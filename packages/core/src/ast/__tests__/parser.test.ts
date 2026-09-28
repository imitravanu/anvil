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

describe("parseFileAst - Go", () => {
  const goCode = `package main

import "fmt"

const MaxRetries = 3

const (
	Timeout = 30
	Version = "1.0"
)

var counter int

var (
	name    string
	enabled bool
)

type Server struct {
	Host string
	Port int
}

type Runner interface {
	Run() error
}

type Alias = Server

func NewServer(host string) *Server {
	return &Server{Host: host}
}

func (s *Server) Start() error {
	fmt.Println(s.Host)
	return nil
}

func (s *Server) stop() {}
`;

  const find = (name: string) => parseFileAst(goCode, "main.go").symbols.find((s) => s.name === name);

  it("routes .go to a Go parser and extracts funcs, methods, types, consts and vars", () => {
    const ast = parseFileAst(goCode, "main.go");
    expect(ast.language).toBe("go");

    const fn = find("NewServer");
    expect(fn?.kind).toBe("function");
    expect(fn?.isExported).toBe(true);
    expect(fn?.signature).toBe("func NewServer(host string) *Server");

    expect(find("Start")?.kind).toBe("method");
    expect(find("Server")?.kind).toBe("struct");
    expect(find("Runner")?.kind).toBe("interface");
    expect(find("Alias")?.kind).toBe("type");
    expect(find("MaxRetries")?.kind).toBe("constant");
    expect(find("counter")?.kind).toBe("variable");
  });

  it("marks unexported identifiers as not exported (Go's uppercase rule)", () => {
    expect(find("stop")?.kind).toBe("method");
    expect(find("stop")?.isExported).toBe(false);
    expect(find("counter")?.isExported).toBe(false);
    expect(find("MaxRetries")?.isExported).toBe(true);
  });

  it("reads every entry of a grouped const/var block, not just the first", () => {
    for (const name of ["Timeout", "Version", "name", "enabled"]) {
      expect(find(name), `${name} missing from its group`).toBeDefined();
    }
  });
});

describe("parseFileAst - Rust declaration coverage", () => {
  const rsCode = `pub enum Mode {
    Fast,
    Slow,
}

pub mod storage {
    pub fn open() -> bool {
        true
    }

    pub struct Handle {
        pub id: u32,
    }
}

impl Mode {
    pub fn label(&self) -> &str {
        "mode"
    }

    fn secret(&self) {}
}

impl fmt::Display for Mode {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "mode")
    }
}

pub type Outcome = std::result::Result<u32, String>;

pub const LIMIT: u32 = 10;
static COUNTER: u32 = 0;

pub union Raw {
    a: u32,
    b: f32,
}
`;
  const ast = parseFileAst(rsCode, "lib.rs");
  const find = (name: string) => ast.symbols.find((s) => s.name === name);

  it("extracts enum, type alias, const, static and union", () => {
    expect(find("Mode")?.kind).toBe("enum");
    expect(find("Outcome")?.kind).toBe("type");
    expect(find("LIMIT")?.kind).toBe("constant");
    expect(find("COUNTER")?.kind).toBe("constant");
    expect(find("Raw")?.kind).toBe("struct");
  });

  it("nests mod contents under the module instead of promoting them", () => {
    const mod = find("storage");
    expect(mod?.kind).toBe("module");
    const childNames = (mod?.children ?? []).map((c) => c.name);
    expect(childNames).toContain("open");
    expect(childNames).toContain("Handle");
    // Nested coordinates are file-absolute, not slice-relative.
    const open = mod?.children?.find((c) => c.name === "open");
    expect(open?.startLine).toBe(7);
  });

  it("attaches impl methods to the impl and reports them as methods", () => {
    const impls = ast.symbols.filter((s) => s.kind === "impl");
    expect(impls.map((s) => s.name)).toEqual(["Mode", "Mode"]);

    const label = impls[0]?.children?.find((c) => c.name === "label");
    expect(label?.kind).toBe("method");
    expect(label?.isExported).toBe(true);
    expect(impls[0]?.children?.find((c) => c.name === "secret")?.kind).toBe("method");

    // The trait-impl form is named after the implementing type.
    expect(impls[1]?.signature).toBe("impl fmt::Display for Mode");
    expect(impls[1]?.children?.some((c) => c.name === "fmt")).toBe(true);

    // No method may also be emitted as a top-level function.
    expect(ast.symbols.filter((s) => s.kind === "function")).toEqual([]);
  });
});

describe("parseFileAst - Python string masking and nesting", () => {
  const names = (src: string) => parseFileAst(src, "a.py").symbols.map((s) => s.name);

  it("does not extract a def from a module docstring", () => {
    const src = '\"\"\"Example usage:\n\ndef fake():\n    pass\n\"\"\"\n\ndef real():\n    pass\n';
    expect(names(src)).toEqual(["real"]);
  });

  it("does not extract a class from an assigned triple-quoted template", () => {
    const src = 'TEMPLATE = \"\"\"\nclass Fake:\n    pass\n\"\"\"\n\ndef real():\n    pass\n';
    expect(names(src)).toEqual(["real"]);
  });

  it("keeps a nested class, with its own members, instead of dropping it", () => {
    const src = [
      "class Outer:",
      "    class Inner:",
      "        def deep(self):",
      "            pass",
      "    def n(self):",
      "        pass",
    ].join("\n");
    const outer = parseFileAst(src, "a.py").symbols.find((s) => s.name === "Outer");
    const inner = outer?.children?.find((c) => c.name === "Inner");

    expect(inner?.kind).toBe("class");
    expect(inner?.children?.map((c) => c.name)).toEqual(["deep"]);
    expect(inner?.startLine).toBe(2);
    expect(outer?.children?.map((c) => c.name)).toEqual(["Inner", "n"]);
  });
});

describe("comment and template masking", () => {
  it("does not index commented-out code as live symbols", () => {
    const ast = parseFileAst("/*\nexport function ghost() {}\n*/\nexport function real() {}\n", "a.ts");
    expect(ast.symbols.map((s) => s.name)).toEqual(["real"]);
  });

  it("keeps correct end lines when a body holds a template with an unbalanced brace", () => {
    const src = [
      "export function first() {",
      "  const s = css`",
      "    .a { color: red;",
      "  `;",
      "}",
      "export function second() {}",
      "export function third() {}",
    ].join("\n");
    const ast = parseFileAst(src, "b.ts");
    const find = (n: string) => ast.symbols.find((s) => s.name === n);

    // The stray `{` inside the template must not push the scanner past the
    // real closing brace and swallow the declarations that follow.
    expect(find("first")?.endLine).toBe(5);
    expect(find("second")?.startLine).toBe(6);
    expect(find("third")?.startLine).toBe(7);
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
