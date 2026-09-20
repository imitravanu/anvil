import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { LspDiagnostic } from "../types.js";
import type { LspStdioClient } from "../client.js";
import { findReferencesExec, getDiagnosticsExec, getHoverExec, gotoDefinitionExec } from "../tools.js";

/**
 * These tests own the *tool-layer* decisions (LSP result vs. grep fallback vs.
 * "no symbol"), so the detector and the client cache are stubbed. The real
 * client is exercised by lspclient.test.ts and lspclientEdges.test.ts.
 */
const h = vi.hoisted(() => ({
  server: null as unknown,
  client: null as unknown,
}));

vi.mock("../detector.js", () => ({
  serverForPath: () => h.server,
  detectLspServers: () => (h.server ? [h.server] : []),
}));

vi.mock("../client.js", () => ({
  getLspClient: async () => h.client,
}));

const TS_SERVER = { language: "typescript", command: "fake-lsp", args: [] };

function makeClient(overrides: Partial<LspStdioClient>): LspStdioClient {
  const base = {
    ensureOpen: () => {},
    waitForDiagnostics: async (): Promise<LspDiagnostic[]> => [],
    gotoDefinition: async () => [],
    findReferences: async () => [],
    hover: async () => null,
  };
  return { ...base, ...overrides } as unknown as LspStdioClient;
}

let root = "";

function mkRepo(files: Record<string, string>): void {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-lsp-tools-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, "utf8");
  }
}

const ctx = () => ({ projectRoot: root, signal: new AbortController().signal });

beforeEach(() => {
  h.server = TS_SERVER;
  h.client = makeClient({});
  mkRepo({
    "src/a.ts": "export function greet(name: string) {\n  return `hi ${name}`;\n}\n",
    "src/b.ts": "import { greet } from './a';\nconsole.log(greet('x'));\n",
    "src/odd.ts": "= 1;\n",
    "notes.txt": "plain text\n",
  });
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("goto_definition via LSP", () => {
  it("returns LSP locations and labels the source as lsp", async () => {
    h.client = makeClient({
      gotoDefinition: async () => [{ path: "/src/a.ts", line: 1, character: 16 }],
    });
    const r = await gotoDefinitionExec({ path: "src/b.ts", line: 1, character: 10 }, ctx());
    expect(r.isError).toBe(false);
    const out = r.output as { source: string; locations: unknown[] };
    expect(out.source).toBe("lsp");
    expect(out.locations).toHaveLength(1);
  });

  it("falls back to a symbol search when LSP finds nothing", async () => {
    // character 17 lands at the end of "greet" in `console.log(greet('x'));`
    const r = await gotoDefinitionExec({ path: "src/b.ts", line: 2, character: 17 }, ctx());
    expect(r.isError).toBe(false);
    const out = r.output as { source: string; symbol: string };
    expect(out.source).toBe("fallback");
    expect(out.symbol).toBe("greet");
  });

  it("reports 'no symbol' when the position carries no word", async () => {
    const r = await gotoDefinitionExec({ path: "src/odd.ts", line: 1, character: 0 }, ctx());
    expect(r.isError).toBe(false);
    expect((r.output as { source: string }).source).toBe("fallback");
    expect(r.summary).toBe("No symbol at position");
  });
});

describe("find_references via LSP", () => {
  it("returns LSP locations when the server resolves them", async () => {
    h.client = makeClient({
      findReferences: async () => [
        { path: "/src/a.ts", line: 1, character: 16 },
        { path: "/src/b.ts", line: 2, character: 12 },
      ],
    });
    const r = await findReferencesExec({ path: "src/b.ts", line: 2, character: 13 }, ctx());
    const out = r.output as { source: string; locations: unknown[] };
    expect(out.source).toBe("lsp");
    expect(out.locations).toHaveLength(2);
  });

  it("reports 'no symbol' on an unworded position", async () => {
    const r = await findReferencesExec({ path: "src/odd.ts", line: 1, character: 0 }, ctx());
    expect(r.isError).toBe(false);
    expect(r.summary).toBe("No symbol at position");
  });
});

describe("get_hover via LSP", () => {
  it("returns the hover string from the server", async () => {
    h.client = makeClient({ hover: async () => "function greet(name: string): string" });
    const r = await getHoverExec({ path: "src/a.ts", line: 1, character: 16 }, ctx());
    const out = r.output as { source: string; hover: string | null };
    expect(out.source).toBe("lsp");
    expect(out.hover).toContain("greet");
  });

  it("degrades to a null hover when the server has none", async () => {
    const r = await getHoverExec({ path: "src/a.ts", line: 1, character: 16 }, ctx());
    const out = r.output as { source: string; hover: null };
    expect(out.source).toBe("fallback");
    expect(out.hover).toBeNull();
  });
});

describe("get_diagnostics via LSP", () => {
  it("returns server diagnostics for a subdirectory, dropping other paths", async () => {
    // A subdirectory target (not the project root) is what makes the scope
    // filter meaningful: diagnostics outside the subtree must be dropped.
    h.client = makeClient({
      waitForDiagnostics: async () => [
        { path: path.join(root, "src", "a.ts"), line: 3, severity: "warning", message: "in scope" },
        { path: path.join(root, "elsewhere", "other.ts"), line: 1, severity: "error", message: "out of scope" },
      ],
    });
    const r = await getDiagnosticsExec({ path: "src" }, ctx());
    const out = r.output as { source: string; diagnostics: { message: string }[] };
    expect(out.source).toBe("lsp");
    expect(out.diagnostics.map((d) => d.message)).toEqual(["in scope"]);
  });

  it("reports 'none' when there is no server and no checker for the file type", async () => {
    h.server = null;
    const r = await getDiagnosticsExec({ path: "notes.txt" }, ctx());
    expect(r.isError).toBe(false);
    const out = r.output as { source: string; diagnostics: unknown[] };
    expect(out.source).toBe("none");
    expect(out.diagnostics).toEqual([]);
  });
});
