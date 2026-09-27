import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { LspDiagnostic } from "../types.js";
import type { LspStdioClient } from "../client.js";
import { checkPostMutationDiagnostics } from "../sensor.js";
import { execute as editFileExec } from "../../tools/editFile.js";
import { execute as writeFileExec } from "../../tools/writeFile.js";
import { getProjectSymbolIndex } from "../../tools/findSymbol.js";

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
    isDead: () => false,
    ensureOpen: () => {},
    waitForDiagnostics: async (): Promise<LspDiagnostic[]> => [],
    diagnosticsForPath: async (): Promise<LspDiagnostic[]> => [],
    gotoDefinition: async () => [],
    findReferences: async () => [],
    hover: async () => null,
  };
  return { ...base, ...overrides } as unknown as LspStdioClient;
}

let root = "";

function mkRepo(files: Record<string, string>): void {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-sensor-test-"));
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
    "src/calc.ts": "export function add(a: number, b: number): number {\n  return a + b;\n}\n",
  });
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("checkPostMutationDiagnostics", () => {
  it("returns empty array when no server is registered", async () => {
    h.server = null;
    const diags = await checkPostMutationDiagnostics(root, path.join(root, "src/calc.ts"), "const x = 1;");
    expect(diags).toEqual([]);
  });

  it("queries client diagnosticsForPath with mutation timestamp", async () => {
    const mockDiags: LspDiagnostic[] = [
      { path: path.join(root, "src/calc.ts"), line: 2, severity: "error", message: "Type mismatch" },
    ];
    let queriedPath = "";
    h.client = makeClient({
      diagnosticsForPath: async (p) => {
        queriedPath = p;
        return mockDiags;
      },
    });

    const abs = path.join(root, "src/calc.ts");
    const diags = await checkPostMutationDiagnostics(root, abs, "bad code");
    expect(queriedPath).toBe(abs);
    expect(diags).toEqual(mockDiags);
  });
});

describe("edit_file post-mutation integration", () => {
  it("attaches compiler diagnostics and updates summary with error badge", async () => {
    const abs = path.join(root, "src/calc.ts");
    h.client = makeClient({
      diagnosticsForPath: async () => [
        { path: abs, line: 2, severity: "error", message: "Cannot find name 'foo'" },
      ],
    });

    const res = await editFileExec(
      {
        path: "src/calc.ts",
        old_str: "return a + b;",
        new_str: "return foo;",
      },
      ctx()
    );

    expect(res.isError).toBe(false);
    expect(res.summary).toContain("⚠ 1 compiler error");
    const out = res.output as { diagnostics?: LspDiagnostic[]; changed: boolean };
    expect(out.changed).toBe(true);
    expect(out.diagnostics).toHaveLength(1);
    expect(out.diagnostics?.[0]?.message).toBe("Cannot find name 'foo'");
  });

  it("updates workspace symbol index incrementally on edit", async () => {
    const index = getProjectSymbolIndex(root);
    await index.buildIndex();
    expect(index.findSymbol("add")).toHaveLength(1);

    await editFileExec(
      {
        path: "src/calc.ts",
        old_str: "export function add",
        new_str: "export function computeSum",
      },
      ctx()
    );

    expect(index.findSymbol("computeSum")).toHaveLength(1);
  });
});

describe("write_file post-mutation integration", () => {
  it("attaches compiler diagnostics and updates summary with warning badge", async () => {
    const abs = path.join(root, "src/newFile.ts");
    h.client = makeClient({
      diagnosticsForPath: async () => [
        { path: abs, line: 1, severity: "warning", message: "Unused variable 'x'" },
      ],
    });

    const res = await writeFileExec(
      {
        path: "src/newFile.ts",
        content: "const x = 10;\n",
      },
      ctx()
    );

    expect(res.isError).toBe(false);
    expect(res.summary).toContain("⚠ 1 compiler warning");
    const out = res.output as { diagnostics?: LspDiagnostic[] };
    expect(out.diagnostics).toHaveLength(1);
    expect(out.diagnostics?.[0]?.severity).toBe("warning");
  });

  it("updates workspace symbol index on file write", async () => {
    const index = getProjectSymbolIndex(root);
    await index.buildIndex();

    await writeFileExec(
      {
        path: "src/service.ts",
        content: "export class PaymentGateway {\n  process() {}\n}\n",
      },
      ctx()
    );

    expect(index.findSymbol("PaymentGateway")).toHaveLength(1);
  });
});
