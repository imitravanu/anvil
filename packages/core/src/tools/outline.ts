import fs from "node:fs/promises";
import path from "node:path";
import { ToolContext, ToolDefinition, ToolExecutor } from "./types.js";
import { EXCLUDED_DIRS, resolveWithinRoot } from "./paths.js";

const CODE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".go",
  ".rs",
  ".md",
]);

export interface OutlineSymbol {
  name: string;
  kind: "function" | "class" | "interface" | "type" | "enum" | "heading" | "variable";
  line: number;
  signature?: string;
}

export interface FileOutline {
  path: string;
  symbols: OutlineSymbol[];
}

export const definition: ToolDefinition = {
  name: "get_outline",
  description:
    "Extract top-level structural symbols (functions, classes, interfaces, types, enums, headings) " +
    "from a specific file or all code files in a directory. Fast, non-mutating, token-efficient outline.",
  inputSchema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "File or directory path relative to project root (default: project root)",
      },
    },
  },
  mutating: false,
};

export function extractSymbols(content: string, ext: string): OutlineSymbol[] {
  const lines = content.split("\n");
  const symbols: OutlineSymbol[] = [];

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const lineNum = i + 1;
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) {
      continue;
    }

    if (ext === ".md") {
      const match = trimmed.match(/^(#{1,4})\s+(.+)$/);
      if (match) {
        symbols.push({
          name: match[2].trim(),
          kind: "heading",
          line: lineNum,
          signature: match[1],
        });
      }
      continue;
    }

    if (ext === ".py") {
      // Column 0 checks for top-level python functions/classes
      if (/^(async\s+)?def\s+([a-zA-Z0-9_]+)\s*\((.*?)\)/.test(rawLine)) {
        const m = rawLine.match(/^(async\s+)?def\s+([a-zA-Z0-9_]+)\s*\((.*?)\)/);
        if (m) {
          symbols.push({
            name: m[2],
            kind: "function",
            line: lineNum,
            signature: `def ${m[2]}(${m[3]})`,
          });
        }
      } else if (/^class\s+([a-zA-Z0-9_]+)(\(.*?\))?:/.test(rawLine)) {
        const m = rawLine.match(/^class\s+([a-zA-Z0-9_]+)(\(.*?\))?:/);
        if (m) {
          symbols.push({
            name: m[1],
            kind: "class",
            line: lineNum,
            signature: `class ${m[1]}${m[2] ?? ""}`,
          });
        }
      }
      continue;
    }

    if (ext === ".go") {
      const funcMatch = trimmed.match(/^func\s+(?:\((.*?)\)\s+)?([a-zA-Z0-9_]+)\s*\((.*?)\)/);
      if (funcMatch) {
        symbols.push({
          name: funcMatch[2],
          kind: "function",
          line: lineNum,
          signature: trimmed.split("{")[0].trim(),
        });
        continue;
      }
      const typeMatch = trimmed.match(/^type\s+([a-zA-Z0-9_]+)\s+(struct|interface)/);
      if (typeMatch) {
        symbols.push({
          name: typeMatch[1],
          kind: typeMatch[2] === "struct" ? "class" : "interface",
          line: lineNum,
          signature: `type ${typeMatch[1]} ${typeMatch[2]}`,
        });
        continue;
      }
    }

    if (ext === ".rs") {
      const fnMatch = trimmed.match(/^(?:pub\s+)?(?:async\s+)?fn\s+([a-zA-Z0-9_]+)/);
      if (fnMatch) {
        symbols.push({
          name: fnMatch[1],
          kind: "function",
          line: lineNum,
          signature: trimmed.split("{")[0].trim(),
        });
        continue;
      }
      const structMatch = trimmed.match(/^(?:pub\s+)?struct\s+([a-zA-Z0-9_]+)/);
      if (structMatch) {
        symbols.push({
          name: structMatch[1],
          kind: "class",
          line: lineNum,
          signature: `struct ${structMatch[1]}`,
        });
        continue;
      }
      const enumMatch = trimmed.match(/^(?:pub\s+)?enum\s+([a-zA-Z0-9_]+)/);
      if (enumMatch) {
        symbols.push({
          name: enumMatch[1],
          kind: "enum",
          line: lineNum,
          signature: `enum ${enumMatch[1]}`,
        });
        continue;
      }
      const traitMatch = trimmed.match(/^(?:pub\s+)?trait\s+([a-zA-Z0-9_]+)/);
      if (traitMatch) {
        symbols.push({
          name: traitMatch[1],
          kind: "interface",
          line: lineNum,
          signature: `trait ${traitMatch[1]}`,
        });
        continue;
      }
    }

    // TypeScript / JavaScript
    if ([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].includes(ext)) {
      const fnMatch = trimmed.match(/^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([a-zA-Z0-9_]+)\s*(?:<.*?>)?\s*\((.*?)\)/);
      if (fnMatch) {
        symbols.push({
          name: fnMatch[1],
          kind: "function",
          line: lineNum,
          signature: trimmed.split("{")[0].trim(),
        });
        continue;
      }

      const classMatch = trimmed.match(/^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([a-zA-Z0-9_]+)/);
      if (classMatch) {
        symbols.push({
          name: classMatch[1],
          kind: "class",
          line: lineNum,
          signature: trimmed.split("{")[0].trim(),
        });
        continue;
      }

      const ifaceMatch = trimmed.match(/^(?:export\s+)?interface\s+([a-zA-Z0-9_]+)/);
      if (ifaceMatch) {
        symbols.push({
          name: ifaceMatch[1],
          kind: "interface",
          line: lineNum,
          signature: trimmed.split("{")[0].trim(),
        });
        continue;
      }

      const typeMatch = trimmed.match(/^(?:export\s+)?type\s+([a-zA-Z0-9_]+)/);
      if (typeMatch) {
        symbols.push({
          name: typeMatch[1],
          kind: "type",
          line: lineNum,
          signature: trimmed.split("=")[0].trim(),
        });
        continue;
      }

      const enumMatch = trimmed.match(/^(?:export\s+)?enum\s+([a-zA-Z0-9_]+)/);
      if (enumMatch) {
        symbols.push({
          name: enumMatch[1],
          kind: "enum",
          line: lineNum,
          signature: `enum ${enumMatch[1]}`,
        });
        continue;
      }

      const constFnMatch = trimmed.match(/^(?:export\s+)?const\s+([a-zA-Z0-9_]+)\s*=\s*(?:async\s*)?(?:\((.*?)\)|[a-zA-Z0-9_]+)\s*=>/);
      if (constFnMatch) {
        symbols.push({
          name: constFnMatch[1],
          kind: "function",
          line: lineNum,
          signature: `const ${constFnMatch[1]} = (...) =>`,
        });
        continue;
      }
    }
  }

  return symbols;
}

const MAX_OUTLINE_FILES = 40;
const MAX_TOTAL_SYMBOLS = 250;

async function collectFiles(targetAbs: string, projectRoot: string): Promise<string[]> {
  const stat = await fs.stat(targetAbs);
  if (stat.isFile()) {
    return [targetAbs];
  }

  const results: string[] = [];
  async function walk(dir: string): Promise<void> {
    if (results.length >= MAX_OUTLINE_FILES) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (EXCLUDED_DIRS.has(e.name)) continue;
        await walk(path.join(dir, e.name));
      } else if (e.isFile()) {
        const ext = path.extname(e.name);
        if (CODE_EXTENSIONS.has(ext)) {
          results.push(path.join(dir, e.name));
          if (results.length >= MAX_OUTLINE_FILES) break;
        }
      }
    }
  }

  await walk(targetAbs);
  return results;
}

export const execute: ToolExecutor = async (input, ctx: ToolContext) => {
  const relPath = (input as { path?: string })?.path ?? ".";
  let abs: string;
  try {
    abs = resolveWithinRoot(ctx.projectRoot, relPath);
  } catch (err: any) {
    return {
      output: { error: err.message ?? "Path escapes project root" },
      isError: true,
      summary: `get_outline failed: ${err.message ?? "Path escapes project root"}`,
    };
  }

  try {
    const files = await collectFiles(abs, ctx.projectRoot);
    if (files.length === 0) {
      return {
        output: { files: [], message: "No source files found." },
        isError: false,
        summary: `No source files found in ${relPath}`,
      };
    }

    const outlines: FileOutline[] = [];
    let totalSymbols = 0;

    for (const fileAbs of files) {
      if (ctx.signal.aborted) throw new Error("Aborted");
      if (totalSymbols >= MAX_TOTAL_SYMBOLS) break;

      const fileRel = path.relative(ctx.projectRoot, fileAbs).split(path.sep).join("/");
      const ext = path.extname(fileAbs);
      try {
        const content = await fs.readFile(fileAbs, "utf8");
        const symbols = extractSymbols(content, ext);
        if (symbols.length > 0) {
          const slice = symbols.slice(0, Math.max(0, MAX_TOTAL_SYMBOLS - totalSymbols));
          totalSymbols += slice.length;
          outlines.push({ path: fileRel, symbols: slice });
        }
      } catch {
        continue;
      }
    }

    return {
      output: {
        totalFilesScanned: files.length,
        totalSymbolsFound: totalSymbols,
        outlines,
      },
      isError: false,
      summary: `Outlined ${outlines.length} files (${totalSymbols} symbols)`,
    };
  } catch (err: any) {
    return {
      output: { error: err.message ?? String(err) },
      isError: true,
      summary: `get_outline failed: ${err.message ?? String(err)}`,
    };
  }
};
