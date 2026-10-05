import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseFileAst } from "../parser.js";
import type { AstSymbol } from "../types.js";

/**
 * Adversarial corpus and whole-repo invariants for the AST scanner.
 *
 * The scanner is a line-oriented approximation of four languages, so its
 * failure mode is always the same shape: a construct it mis-reads shifts the
 * brace/paren bookkeeping and either swallows the declarations that follow or
 * publishes something that is not a declaration at all. These two suites pin the
 * first half — every case appends a SENTINEL declaration after its subject, so a
 * boundary that swallows following code fails loudly rather than silently
 * shortening an outline — and the second half, which runs the same invariants
 * over every source file in the repository.
 */
type Case = {
  name: string;
  file: string;
  body: string;
  sentinel: string;
  expect: Array<{ name: string; kind?: string; startLine?: number; endLine?: number }>;
  /** Names that must NOT be indexed at file level — nested locals, keywords. */
  absent?: string[];
  /** A container's member names, in order. */
  members?: { name: string; children: string[] };
};

const TS_SENTINEL = "export function sentinelFn() { return 1; }";
const PY_SENTINEL = "def sentinel_fn():\n    return 1";
const RS_SENTINEL = "pub fn sentinel_fn() {}";
const GO_SENTINEL = "func sentinelFn() {}";

type Extra = {
  expect?: Case["expect"];
  absent?: string[];
  members?: Case["members"];
};

const TS = (name: string, body: string, expect: Case["expect"] = [], extra: Omit<Extra, "expect"> = {}): Case => ({
  name,
  file: "probe.ts",
  body,
  sentinel: TS_SENTINEL,
  expect,
  ...extra,
});
const TSX = (name: string, body: string, expect: Case["expect"] = []): Case => ({
  name,
  file: "probe.tsx",
  body,
  sentinel: TS_SENTINEL,
  expect,
});
const PY = (name: string, body: string, expect: Case["expect"] = []): Case => ({
  name,
  file: "probe.py",
  body,
  sentinel: PY_SENTINEL,
  expect,
});
const RS = (name: string, body: string, expect: Case["expect"] = []): Case => ({
  name,
  file: "probe.rs",
  body,
  sentinel: RS_SENTINEL,
  expect,
});
const GO = (name: string, body: string, expect: Case["expect"] = []): Case => ({
  name,
  file: "probe.go",
  body,
  sentinel: GO_SENTINEL,
  expect,
});

const cases: Case[] = [
  // ---------------------------- TypeScript / JavaScript ----------------------------
  TS("plain function and const", "export function alpha() {}\nexport const beta = 1;", [
    { name: "alpha", kind: "function" },
    { name: "beta", kind: "constant" },
  ]),
  TS("shebang then export", "#!/usr/bin/env node\nexport function gamma() {}", [{ name: "gamma" }]),
  TS("brace inside a string", 'export const s = "}";\nexport function delta() {}', [{ name: "s" }, { name: "delta" }]),
  TS("brace inside a template", "export const t = `${ {a: 1} }`;\nexport function eps() {}", [{ name: "t" }, { name: "eps" }]),
  TS("multi-line template with an unbalanced brace", "export const big = `line1\nline2 { unbalanced`;\nexport function zeta() {}", [{ name: "big" }, { name: "zeta" }]),
  TS("comment holding a brace and a quote", '/* } " */\nexport function eta() {}', [{ name: "eta" }]),
  TS("url in a string then a declaration", 'export const url = "https://example.com/a/b";\nexport function theta() {}', [{ name: "url" }, { name: "theta" }]),
  TS("regex literal holding a backtick", "export const re = /[`{}]/g;\nexport function iota() {}", [{ name: "re" }, { name: "iota" }]),
  TS("division is not a regex", "export const half = 1 / 2;\nexport function kappa() {}", [{ name: "half" }, { name: "kappa" }]),
  TS("one-line import does not swallow the next class", 'import { A, B } from "./x.js";\nexport class AfterImport {\n  run() {}\n}', [
    { name: "AfterImport", kind: "class" },
  ]),
  TS("multi-line import list is not a declaration list", 'import {\n  type DisplaySubAgent,\n} from "./x.js";\nexport function realFn() {}', [{ name: "realFn" }]),
  TS("overloaded function keeps every declaration", "export function over(a: string): void;\nexport function over(a: number): void;\nexport function over(a: unknown) { return a; }", [{ name: "over", kind: "function" }]),
  TS("generic arrow with a trailing comma", "export const id = <T,>(x: T): T => x;\nexport function lam() {}", [{ name: "id" }, { name: "lam" }]),
  TS("object literal with nested braces", "export const cfg = { a: { b: { c: 1 } } };\nexport function nu() {}", [{ name: "cfg" }, { name: "nu" }]),
  TS("class with private members and a static block", "export class Foo {\n  #priv = 1;\n  static { init(); }\n  get x() { return this.#priv; }\n  set x(v: number) { this.#priv = v; }\n}\nexport function xi() {}", [
    { name: "Foo", kind: "class" },
    { name: "xi" },
  ]),
  TS("abstract class with an abstract method", "export abstract class Abs {\n  abstract run(): void;\n  stop() {}\n}\nexport function omicron() {}", [
    { name: "Abs", kind: "class" },
    { name: "omicron" },
  ]),
  TS("generator, async and plain functions", "export function* gen() { yield 1; }\nexport async function af() {}\nexport function rho() {}", [{ name: "gen" }, { name: "af" }, { name: "rho" }]),
  TS("destructured const then a declaration", "export const { a, b } = obj;\nexport function sigma() {}", [{ name: "sigma" }]),
  TS("namespace declaration", "export namespace NS {\n  export const v = 1;\n}\nexport function tau() {}", [{ name: "tau" }]),
  TS("declare global augmentation", "declare global {\n  interface Window { x: number }\n}\nexport function upsi() {}", [{ name: "upsi" }]),
  TS("decorated class and method", "export function dec() { return () => {}; }\n@dec()\nexport class Dec {\n  @dec() method() {}\n}\nexport function phi() {}", [{ name: "Dec", kind: "class" }, { name: "phi" }]),
  TS("export-star-as then a declaration", 'export * as util from "./util.js";\nexport function chi() {}', [{ name: "chi" }]),
  TS("import type then a declaration", 'import type { X } from "./x.js";\nexport function psi() {}', [{ name: "psi" }]),
  TS("satisfies and as const", "export const table = { a: 1 } as const;\nexport const chk = 1n satisfies bigint;\nexport function omega() {}", [{ name: "table" }, { name: "chk" }, { name: "omega" }]),
  TS("CRLF line endings", "export function crlf() {\r\n  return 1;\r\n}\r\nexport const after = 1;\r\n", [{ name: "crlf" }, { name: "after" }]),
  TS("interface with methods and generics", "export interface Deep<T> {\n  map<U>(f: (t: T) => U): Deep<U>;\n  readonly x?: T;\n}\nexport function alph() {}", [{ name: "Deep", kind: "interface" }, { name: "alph" }]),
  TS("type alias with a function type", "export type Handler = (e: string) => Promise<void>;\nexport function bet() {}", [{ name: "Handler", kind: "type" }, { name: "bet" }]),
  TS("enum with members", "export enum Colour { Red = 1, Green };\nexport function gam() {}", [{ name: "Colour", kind: "enum" }, { name: "gam" }]),
  TS("if-block nested function", "export function outer() {\n  if (true) {\n    function inner() {}\n  }\n}\nexport function del() {}", [{ name: "outer" }, { name: "del" }]),
  TS("empty file", "", []),
  TS("only comments", "// nothing here\n/* nor here */", []),
  TS("string with an escaped quote and a brace", 'export const esc = "a\\"}b";\nexport function escAfter() {}', [{ name: "esc" }, { name: "escAfter" }]),

  // ---------------------------- Declaration spans ----------------------------
  TS(
    "destructured parameter list is not the body",
    'export function App({ session, model }: { session: string; model: string }) {\n  const helper = () => session;\n  return helper();\n}\nexport function after() {}',
    [
      { name: "App", kind: "function", startLine: 1, endLine: 4 },
      { name: "after", startLine: 5 },
    ],
    { absent: ["helper"] }
  ),
  TS(
    "multi-line parameter list is not the body",
    "export function supported(\n  stdout: string,\n  env: Record<string, string | undefined>\n): boolean {\n  return stdout.length > 0;\n}\nexport function afterMulti() {}",
    [
      { name: "supported", startLine: 1, endLine: 6 },
      { name: "afterMulti", startLine: 7 },
    ]
  ),
  TS(
    "multi-line object return type is not the body",
    "export function classify(err: unknown): {\n  code: string;\n  retryable: boolean;\n} {\n  return { code: String(err), retryable: false };\n}\nexport function afterClassify() {}",
    [
      { name: "classify", startLine: 1, endLine: 6 },
      { name: "afterClassify", startLine: 7 },
    ]
  ),
  TS(
    "generic return type is not the body",
    "export async function rewind(id: number): Promise<{\n  ok: boolean;\n}> {\n  return { ok: id > 0 };\n}\nexport function afterRewind() {}",
    [
      { name: "rewind", startLine: 1, endLine: 5 },
      { name: "afterRewind", startLine: 6 },
    ]
  ),
  TS(
    "type predicate is not the body",
    'function hasMessage(err: unknown): err is { message: string } {\n  return typeof err === "object" && err !== null && "message" in err;\n}\nexport function afterPredicate() {}',
    [
      { name: "hasMessage", startLine: 1, endLine: 3 },
      { name: "afterPredicate", startLine: 4 },
    ]
  ),
  TS(
    "single-line object return type is not the body",
    "export function oneLine(): { a: string } {\n  return { a: \"x\" };\n}\nexport function afterOneLine() {}",
    [
      { name: "oneLine", startLine: 1, endLine: 3 },
      { name: "afterOneLine", startLine: 4 },
    ]
  ),
  TS(
    "paren-wrapped arrow body does not adopt the next block",
    'const violation = (rule: string) => ({\n  file: "src/a.ts",\n  rule,\n});\ndescribe("suite", () => {\n  it("works", () => {\n    expect(violation("x")).toBeDefined();\n  });\n});',
    [{ name: "violation", startLine: 1, endLine: 4 }]
  ),
  TS(
    "one-line method bodies stay indexed",
    "export class K {\n  müller() {}\n  plain() {}\n}",
    [{ name: "K", kind: "class", startLine: 1, endLine: 4 }],
    { members: { name: "K", children: ["müller", "plain"] } }
  ),
  TS(
    "generator and accessor members are named, not walked into",
    "export class Tracker {\n  private seen = 0;\n  async *streamCompletion() {\n    for (const x of [1]) {\n      if (x) yield x;\n    }\n  }\n  get count(): number {\n    return this.seen;\n  }\n}",
    [{ name: "Tracker", kind: "class", startLine: 1, endLine: 11 }],
    { members: { name: "Tracker", children: ["streamCompletion", "count"] }, absent: ["for", "if"] }
  ),
  TS(
    "statements inside a callback are not file-level symbols",
    'export const wrapped = useCallback((x: number) => {\n  const updateAssistant = () => x;\n  return updateAssistant();\n}, []);\nexport function outside() {}',
    [
      { name: "wrapped", startLine: 1 },
      { name: "outside", startLine: 5 },
    ],
    { absent: ["updateAssistant"] }
  ),

  // ---------------------------- .tsx ----------------------------
  TSX("JSX component then a declaration", 'export function Comp() { return <div className="x">{1}</div>; }\nexport function afterComp() {}', [
    { name: "Comp" },
    { name: "afterComp" },
  ]),
  TSX("JSX with a brace in text", 'export function Q() {\n  return <p>{"}"}</p>;\n}\nexport function afterQ() {}', [{ name: "Q" }, { name: "afterQ" }]),
  TSX(
    "JSX comment with an apostrophe does not hide the closing brace",
    "function Zone() {\n  return (\n    <Box>\n      {/* every zone keeps its rows: each other's rows. */}\n      <Header />\n    </Box>\n  );\n}\nexport function afterZone() {}",
    [{ name: "Zone" }, { name: "afterZone" }]
  ),

  // ---------------------------- Python ----------------------------
  PY("f-string with braces", 'def f():\n    return f"{ {1: 2} }"\ndef after_f():\n    pass', [{ name: "f" }, { name: "after_f" }]),
  PY("docstring containing a def", 'def real():\n    """\n    def fake():\n        pass\n    """\n    return 1\ndef after_real():\n    pass', [{ name: "real" }, { name: "after_real" }]),
  PY("decorated async def", "@decorator\nasync def fetch():\n    return 1\ndef after_fetch():\n    pass", [{ name: "fetch" }, { name: "after_fetch" }]),
  PY("nested class", "class Outer:\n    class Inner:\n        def m(self):\n            pass\n    def n(self):\n        pass\ndef after_outer():\n    pass", [{ name: "Outer" }, { name: "after_outer" }]),
  PY("triple-quoted assigned template", 'SCHEMA = """\nclass NotAClass:\n    def not_a_def(self):\n        pass\n"""\ndef after_schema():\n    pass', [{ name: "after_schema" }]),
  PY("lambda and dict braces", "lookup = lambda k: {'a': 1}[k]\ndef after_lookup():\n    pass", [{ name: "after_lookup" }]),

  // ---------------------------- Rust ----------------------------
  RS("raw string with an unbalanced brace", 'pub const S: &str = r#"{ unbalanced"#;\npub fn after_raw() {}', [{ name: "S" }, { name: "after_raw" }]),
  RS("macro with escaped braces", 'pub fn m() {\n    println!("{{}}");\n}\npub fn after_m() {}', [{ name: "m" }, { name: "after_m" }]),
  RS("generic impl", "pub struct Wrapper<T>(T);\nimpl<T: Clone> Wrapper<T> {\n    pub fn get(&self) -> T { self.0.clone() }\n}\npub fn after_impl() {}", [{ name: "Wrapper" }, { name: "after_impl" }]),
  RS("char literal and lifetime", "pub fn life<'a>(s: &'a str) -> char {\n    s.chars().next().unwrap_or('}')\n}\npub fn after_life() {}", [{ name: "life" }, { name: "after_life" }]),
  RS("pub(crate) fn", "pub(crate) fn scoped() {}\npub fn after_scoped() {}", [{ name: "scoped" }, { name: "after_scoped" }]),
  RS("trait with a default method", "pub trait T {\n    fn required(&self);\n    fn provided(&self) {}\n}\npub fn after_trait() {}", [{ name: "T" }, { name: "after_trait" }]),

  // ---------------------------- Go ----------------------------
  GO('backtick struct tag with braces', 'package main\n\ntype S struct {\n\tField string `json:"field,omitempty"`\n}\n\nfunc afterTag() {}', [{ name: "S" }, { name: "afterTag" }]),
  GO("raw string literal with a brace", "package main\n\nvar q = `{ unbalanced`\n\nfunc afterQ() {}", [{ name: "afterQ" }]),
  GO("grouped const and var", "package main\n\nconst (\n\tA = 1\n\tB = 2\n)\n\nvar (\n\tC = 3\n)\n\nfunc afterGroups() {}", [{ name: "A" }, { name: "B" }, { name: "C" }, { name: "afterGroups" }]),
  GO("method with a receiver", "package main\n\ntype R struct{}\n\nfunc (r R) Method() {}\n\nfunc (r *R) PtrMethod() {}\n\nfunc afterMethod() {}", [{ name: "Method" }, { name: "PtrMethod" }, { name: "afterMethod" }]),
  GO("interface methods and an embedded interface", "package main\n\ntype I interface {\n\tA()\n\tB() error\n}\n\nfunc afterIface() {}", [{ name: "I" }, { name: "afterIface" }]),
];

function walk(symbols: AstSymbol[], fn: (symbol: AstSymbol) => void): void {
  for (const symbol of symbols) {
    fn(symbol);
    if (symbol.children) walk(symbol.children, fn);
  }
}

describe("AST scanner adversarial corpus", () => {
  for (const testCase of cases) {
    it(`${testCase.file}: ${testCase.name}`, () => {
      const content = `${testCase.body}${testCase.body.endsWith("\n") ? "" : "\n"}${testCase.sentinel}\n`;
      const ast = parseFileAst(content, testCase.file);
      const names: string[] = [];
      const problems: string[] = [];

      walk(ast.symbols, (symbol) => {
        names.push(symbol.name);
        if (symbol.startLine < 1) problems.push(`${symbol.name} startLine=${symbol.startLine}`);
        if (symbol.endLine < symbol.startLine) problems.push(`${symbol.name} ${symbol.startLine}..${symbol.endLine} inverted`);
        if (symbol.endLine > ast.totalLines) problems.push(`${symbol.name} endLine=${symbol.endLine} > ${ast.totalLines}`);
        if (symbol.bodyStartLine !== undefined && symbol.bodyEndLine !== undefined) {
          if (symbol.bodyEndLine < symbol.bodyStartLine) {
            problems.push(`${symbol.name} body ${symbol.bodyStartLine}..${symbol.bodyEndLine} inverted`);
          }
        }
      });

      // The sentinel is the anti-swallow probe: a boundary that consumes the
      // code after it hides a declaration, and no other assertion would notice.
      expect(names, `sentinel declaration was swallowed: ${names.join(", ")}`).toContain(
        testCase.file.endsWith(".py") || testCase.file.endsWith(".rs") ? "sentinel_fn" : "sentinelFn"
      );

      for (const expected of testCase.expect) {
        const found = ast.symbols.find((symbol) => symbol.name === expected.name) ?? null;
        expect(found, `${expected.name} must be indexed`).not.toBeNull();
        if (expected.kind) expect(found?.kind, `${expected.name} kind`).toBe(expected.kind);
        if (expected.startLine !== undefined) {
          expect(found?.startLine, `${expected.name} startLine`).toBe(expected.startLine);
        }
        if (expected.endLine !== undefined) {
          expect(found?.endLine, `${expected.name} endLine`).toBe(expected.endLine);
        }
      }

      // A nested local or a control-flow keyword is not a file-level symbol.
      for (const name of testCase.absent ?? []) {
        expect(names, `${name} must not be indexed at file level`).not.toContain(name);
      }

      if (testCase.members) {
        const container = ast.symbols.find((symbol) => symbol.name === testCase.members!.name);
        expect(container?.children?.map((child) => child.name)).toEqual(testCase.members.children);
      }

      expect(problems).toEqual([]);
    });
  }
});

const REPO_ROOT = fileURLToPath(new URL("../../../../..", import.meta.url));
const SOURCE_DIRS = ["packages", "scripts", "evals"];
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".mts", ".py", ".rs", ".go"]);
const SKIPPED_DIRS = new Set(["node_modules", "dist", ".git", "__visual-baselines__"]);
const RESERVED_WORDS = new Set([
  "if", "for", "while", "switch", "catch", "do", "else", "return", "case", "with", "finally", "try", "new",
]);

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIPPED_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, found);
    else if (SOURCE_EXTENSIONS.has(entry.slice(entry.lastIndexOf(".")))) found.push(full);
  }
  return found;
}

/**
 * Whole-repo invariants. The synthetic corpus above only covers constructs
 * somebody thought to write down; this runs the scanner over the repository's
 * own sources and asserts the properties that must hold for EVERY file, which is
 * how the class-body and parameter-list defects below were found:
 *
 *   - `parseFileAst` never throws on real code.
 *   - Every span is inside its file and not inverted.
 *   - No file reports the same top-level name twice. A file-level name is unique
 *     within a file, so a repeat means the scanner reached into a body it had
 *     already passed — providers/base.ts reported `BaseProvider` once but
 *     duplicate `streamCompletion`, and useAgentController.ts reported its two
 *     useCallback locals as file-level functions.
 *   - No symbol is named after a control-flow keyword. Indexing `if (` as a
 *     method meant the member scan had walked into a method body it failed to
 *     recognize (base.ts alone produced them, hence the `async *` fix).
 */
describe("AST scanner repo-wide invariants", () => {
  const files = SOURCE_DIRS.flatMap((dir) => sourceFiles(join(REPO_ROOT, dir)));

  it("finds the repository's own sources to check", () => {
    // A walk that silently returns nothing would make every assertion below
    // vacuous, so the corpus size is itself an assertion.
    expect(files.length).toBeGreaterThan(200);
  });

  it("parses every source file with sound spans and no invented names", () => {
    const problems: string[] = [];

    for (const file of files) {
      const relative = file.slice(REPO_ROOT.length + 1);
      const content = readFileSync(file, "utf8");
      let ast: ReturnType<typeof parseFileAst>;
      try {
        ast = parseFileAst(content, file);
      } catch (err) {
        problems.push(`${relative}: threw ${String(err)}`);
        continue;
      }

      const seen = new Set<string>();
      walk(ast.symbols, (symbol) => {
        if (symbol.startLine < 1) problems.push(`${relative}: ${symbol.name} startLine=${symbol.startLine}`);
        if (symbol.endLine < symbol.startLine) problems.push(`${relative}: ${symbol.name} ${symbol.startLine}..${symbol.endLine} inverted`);
        if (symbol.endLine > ast.totalLines) problems.push(`${relative}: ${symbol.name} endLine=${symbol.endLine} > ${ast.totalLines}`);
        if (symbol.bodyStartLine !== undefined && symbol.bodyEndLine !== undefined && symbol.bodyEndLine < symbol.bodyStartLine) {
          problems.push(`${relative}: ${symbol.name} body ${symbol.bodyStartLine}..${symbol.bodyEndLine} inverted`);
        }
        if (RESERVED_WORDS.has(symbol.name)) problems.push(`${relative}: ${symbol.name} is a control-flow keyword`);
      });

      for (const symbol of ast.symbols) {
        if (seen.has(symbol.name)) problems.push(`${relative}: duplicate top-level symbol ${symbol.name}`);
        seen.add(symbol.name);
      }
    }

    expect(problems).toEqual([]);
  });
});
