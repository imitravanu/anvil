import fs from "node:fs/promises";
import path from "node:path";
import { getErrorMessage } from "../errors.js";
import { LSP_MAX_DIAGNOSTICS } from "../config/constants.js";
import { resolveWithinRoot } from "../tools/paths.js";
import type { ToolContext, ToolDefinition, ToolExecutor } from "../tools/types.js";
import { serverForPath } from "./detector.js";
import { getLspClient, type LspStdioClient } from "./client.js";

/**
 * Phase 25.3 — LSP-backed code intelligence tools.
 * Each tool tries a language server first and falls back to the
 * regex/grep engine with an honest `source` field ("lsp" | "fallback").
 */

function symbolAt(content: string, line: number, character: number): string | null {
  const lines = content.split("\n");
  const text = lines[line - 1] ?? "";
  const before = text.slice(0, character);
  const match = before.match(/[A-Za-z0-9_]+$/);
  if (match) return match[0];
  const after = text.slice(character).match(/^[A-Za-z0-9_]+/);
  return after ? after[0] : null;
}

async function grepFallback(projectRoot: string, symbol: string, signal: AbortSignal): Promise<{ path: string; line: number }[]> {
  const { execute: grepExec } = await import("../tools/grep.js");
  const result = await grepExec({ pattern: symbol }, { projectRoot, signal });
  const output = result.output as { matches: { path: string; line: number; text: string }[]; truncated: boolean };
  const matches = Array.isArray(output.matches) ? output.matches : [];
  return matches.slice(0, 20).map((m) => ({
    path: m.path,
    line: m.line,
  }));
}

async function withClient<T>(
  projectRoot: string,
  relPath: string,
  fn: (client: LspStdioClient, abs: string) => Promise<T>
): Promise<{ value: T | undefined; source: "lsp" | "none" }> {
  let abs: string;
  try {
    abs = resolveWithinRoot(projectRoot, relPath);
  } catch {
    throw new Error("Path escapes project root");
  }
  const server = serverForPath(abs);
  if (!server) return { value: undefined as T, source: "none" };
  // A2: reuse a cached server per project+language instead of spawning one per
  // call. The cache owns the lifecycle — it closes on idle/timeout/process exit.
  const client = await getLspClient(server, projectRoot);
  if (!client) return { value: undefined as T, source: "none" };
  // A1: open/sync the document so definition/references/hover actually resolve.
  const text = await fs.readFile(abs, "utf8").catch(() => "");
  if (text) client.ensureOpen(abs, server.language, text);
  return { value: await fn(client, abs), source: "lsp" };
}

export const gotoDefinitionDef: ToolDefinition = {
  name: "goto_definition",
  description: "Jump to the definition of the symbol at a file position (LSP when available, grep fallback).",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path relative to project root" },
      line: { type: "number", description: "1-based line number" },
      character: { type: "number", description: "0-based character offset" },
    },
    required: ["path", "line"],
  },
  mutating: false,
};

export const gotoDefinitionExec: ToolExecutor = async (input, ctx: ToolContext) => {
  const args = input as { path?: unknown; line?: unknown; character?: unknown };
  if (typeof args.path !== "string" || typeof args.line !== "number") {
    return { output: { error: "goto_definition needs path (string) and line (number)" }, isError: true, summary: "goto_definition failed: bad input" };
  }
  const character = typeof args.character === "number" ? args.character : 0;
  try {
    const attempted = await withClient(ctx.projectRoot, args.path, (client, abs) =>
      client.gotoDefinition(abs, { line: args.line as number, character })
    );
    if (attempted.source === "lsp" && Array.isArray(attempted.value) && attempted.value.length > 0) {
      const locations = attempted.value as { path: string; line: number; character: number }[];
      return { output: { source: "lsp", locations }, isError: false, summary: `Found ${locations.length} definition(s) via LSP` };
    }
    const abs = resolveWithinRoot(ctx.projectRoot, args.path);
    const content = await fs.readFile(abs, "utf8");
    const symbol = symbolAt(content, args.line, character);
    if (!symbol) {
      return { output: { source: "fallback", locations: [] }, isError: false, summary: "No symbol at position" };
    }
    const locations = await grepFallback(ctx.projectRoot, `\\b${symbol}\\b`, ctx.signal);
    return { output: { source: "fallback", symbol, locations }, isError: false, summary: `Found ${locations.length} candidate(s) via fallback search` };
  } catch (err: unknown) {
    return { output: { error: getErrorMessage(err) }, isError: true, summary: `goto_definition failed: ${getErrorMessage(err)}` };
  }
};

export const findReferencesDef: ToolDefinition = {
  name: "find_references",
  description: "Find references to the symbol at a file position (LSP when available, grep fallback).",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path relative to project root" },
      line: { type: "number", description: "1-based line number" },
      character: { type: "number", description: "0-based character offset" },
    },
    required: ["path", "line"],
  },
  mutating: false,
};

export const findReferencesExec: ToolExecutor = async (input, ctx: ToolContext) => {
  const args = input as { path?: unknown; line?: unknown; character?: unknown };
  if (typeof args.path !== "string" || typeof args.line !== "number") {
    return { output: { error: "find_references needs path (string) and line (number)" }, isError: true, summary: "find_references failed: bad input" };
  }
  const character = typeof args.character === "number" ? args.character : 0;
  try {
    const attempted = await withClient(ctx.projectRoot, args.path, (client, abs) =>
      client.findReferences(abs, { line: args.line as number, character })
    );
    if (attempted.source === "lsp" && Array.isArray(attempted.value) && attempted.value.length > 0) {
      const locations = attempted.value as { path: string; line: number; character: number }[];
      return { output: { source: "lsp", locations }, isError: false, summary: `Found ${locations.length} reference(s) via LSP` };
    }
    const abs = resolveWithinRoot(ctx.projectRoot, args.path);
    const content = await fs.readFile(abs, "utf8");
    const symbol = symbolAt(content, args.line, character);
    if (!symbol) {
      return { output: { source: "fallback", locations: [] }, isError: false, summary: "No symbol at position" };
    }
    const locations = await grepFallback(ctx.projectRoot, symbol, ctx.signal);
    return { output: { source: "fallback", symbol, locations }, isError: false, summary: `Found ${locations.length} reference(s) via fallback search` };
  } catch (err: unknown) {
    return { output: { error: getErrorMessage(err) }, isError: true, summary: `find_references failed: ${getErrorMessage(err)}` };
  }
};

export const getHoverDef: ToolDefinition = {
  name: "get_hover",
  description: "Hover type info for the symbol at a file position (LSP when available).",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path relative to project root" },
      line: { type: "number", description: "1-based line number" },
      character: { type: "number", description: "0-based character offset" },
    },
    required: ["path", "line"],
  },
  mutating: false,
};

export const getHoverExec: ToolExecutor = async (input, ctx: ToolContext) => {
  const args = input as { path?: unknown; line?: unknown; character?: unknown };
  if (typeof args.path !== "string" || typeof args.line !== "number") {
    return { output: { error: "get_hover needs path (string) and line (number)" }, isError: true, summary: "get_hover failed: bad input" };
  }
  const character = typeof args.character === "number" ? args.character : 0;
  try {
    const attempted = await withClient(ctx.projectRoot, args.path, (client, abs) =>
      client.hover(abs, { line: args.line as number, character })
    );
    if (attempted.source === "lsp" && typeof attempted.value === "string" && attempted.value.length > 0) {
      return { output: { source: "lsp", hover: attempted.value }, isError: false, summary: "Hover info via LSP" };
    }
    return { output: { source: "fallback", hover: null }, isError: false, summary: "No LSP hover available (no language server installed)" };
  } catch (err: unknown) {
    return { output: { error: getErrorMessage(err) }, isError: true, summary: `get_hover failed: ${getErrorMessage(err)}` };
  }
};

export const getDiagnosticsDef: ToolDefinition = {
  name: "get_diagnostics",
  description: "Language diagnostics for a file or directory (LSP when available, tsc --noEmit for TypeScript fallback).",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "File or directory relative to project root (default: project root)" },
    },
  },
  mutating: false,
};

export const getDiagnosticsExec: ToolExecutor = async (input, ctx: ToolContext) => {
  const rawPath = (input as { path?: unknown })?.path;
  const relPath = typeof rawPath === "string" ? rawPath : ".";
  try {
    const abs = resolveWithinRoot(ctx.projectRoot, relPath);
    const stat = await fs.stat(abs).catch(() => null);
    const isFile = stat?.isFile() === true;
    const target = isFile ? abs : path.join(ctx.projectRoot, "package.json");
    const server = serverForPath(isFile ? abs : "file.ts");
    if (server) {
      // A2: reuse a cached server (the cache owns the lifecycle — do NOT close).
      const client = await getLspClient(server, ctx.projectRoot);
      if (client) {
        // A1/A7: open the document so the server actually computes diagnostics,
        // then wait a bounded drain for publishDiagnostics to arrive.
        if (isFile) {
          const text = await fs.readFile(abs, "utf8").catch(() => "");
          if (text) client.ensureOpen(abs, server.language, text);
        }
        const all = await client.waitForDiagnostics(1500);
        const scoped = all
          .filter((d) => d.path === abs || abs === ctx.projectRoot || d.path.startsWith(abs))
          .slice(0, LSP_MAX_DIAGNOSTICS);
        if (scoped.length > 0) {
          return { output: { source: "lsp", diagnostics: scoped }, isError: false, summary: `${scoped.length} diagnostic(s) via LSP` };
        }
      }
    }
    // TypeScript fallback: tsc --noEmit when the file is TS and tsc exists.
    if (target.endsWith("package.json") || /\.(ts|tsx)$/.test(abs)) {
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const execFileAsync = promisify(execFile);
      try {
        await execFileAsync("npx", ["--no-install", "tsc", "--noEmit", "--pretty", "false"], {
          cwd: ctx.projectRoot,
          timeout: 30_000,
        });
        return { output: { source: "tsc", diagnostics: [] }, isError: false, summary: "No diagnostics (tsc clean)" };
      } catch (err: unknown) {
        const out = getErrorMessage(err);
        return { output: { source: "tsc", diagnostics: [], raw: out.slice(0, 4000) }, isError: false, summary: "Diagnostics via tsc fallback" };
      }
    }
    return { output: { source: "none", diagnostics: [] }, isError: false, summary: "No language server or checker available" };
  } catch (err: unknown) {
    return { output: { error: getErrorMessage(err) }, isError: true, summary: `get_diagnostics failed: ${getErrorMessage(err)}` };
  }
};
