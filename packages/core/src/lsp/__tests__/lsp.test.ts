import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { detectLspServers, serverForPath } from "../detector.js";
import { gotoDefinitionExec, findReferencesExec, getHoverExec, getDiagnosticsExec } from "../tools.js";

function makeRoot(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-lsp-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return root;
}

describe("LSP detector", () => {
  it("returns an array without throwing", () => {
    expect(Array.isArray(detectLspServers())).toBe(true);
  });

  it("maps extensions to languages", () => {
    expect(serverForPath("a.ts", [{ language: "typescript", command: "x", args: [] }])?.language).toBe("typescript");
    expect(serverForPath("a.py", [{ language: "typescript", command: "x", args: [] }])).toBeNull();
    expect(serverForPath("notes.txt", [])).toBeNull();
  });
});

describe("LSP tools fallback", () => {
  let root = "";
  beforeEach(() => {
    root = makeRoot({
      "src/a.ts": "export function greet(name: string) {\n  return `hi ${name}`;\n}\n",
      "src/b.ts": "import { greet } from './a';\nconsole.log(greet('x'));\n",
    });
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const ctx = () => ({ projectRoot: root, signal: new AbortController().signal });

  it("goto_definition rejects bad input", async () => {
    const r = await gotoDefinitionExec({}, ctx());
    expect(r.isError).toBe(true);
  });

  it("goto_definition falls back to grep when no server", async () => {
    const r = await gotoDefinitionExec({ path: "src/b.ts", line: 1, character: 10 }, ctx());
    expect(r.isError).toBe(false);
    expect((r.output as { source: string }).source).toBe("fallback");
  });

  it("find_references falls back to grep when no server", async () => {
    const r = await findReferencesExec({ path: "src/b.ts", line: 2, character: 13 }, ctx());
    expect(r.isError).toBe(false);
    expect((r.output as { source: string }).source).toBe("fallback");
  });

  it("get_hover reports unavailable without a server", async () => {
    const r = await getHoverExec({ path: "src/a.ts", line: 1, character: 16 }, ctx());
    expect(r.isError).toBe(false);
    expect((r.output as { source: string }).source).toMatch(/fallback|lsp/);
  });

  it("get_diagnostics never throws and reports a source", async () => {
    // This triggers the real `npx --no-install tsc --noEmit` subprocess when no
    // LSP server is available, which is genuinely slow under parallel load.
    const r = await getDiagnosticsExec({ path: "src/a.ts" }, ctx());
    expect(r.isError).toBe(false);
    expect(typeof (r.output as { source: string }).source).toBe("string");
  }, 20_000);

  it("tools refuse paths escaping the root", async () => {
    const r = await gotoDefinitionExec({ path: "../outside.ts", line: 1 }, ctx());
    expect(r.isError).toBe(true);
  });
});
