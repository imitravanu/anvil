import fs from "node:fs/promises";
import path from "node:path";
import { ToolContext, ToolDefinition, ToolExecutor } from "./types.js";
import { resolveWithinRoot } from "./paths.js";

const EXCLUDED_DIRS = new Set(["node_modules", ".git", "dist", ".anvil"]);

// Supports ** (any depth, including zero directory levels), * (within a
// segment), ? (single char). e.g. "src/**/*.ts" matches both "src/a.ts" and
// "src/sub/b.ts".
function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*\//g, "\u0000") // "**/" covers zero or more directory levels
    .replace(/\*\*/g, "\u0001")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/\u0000/g, "(?:.*/)?")
    .replace(/\u0001/g, ".*");
  return new RegExp(`^${escaped}$`);
}

async function walk(dir: string, root: string, out: string[]): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return; // unreadable dir — skip silently
  }
  for (const entry of entries) {
    if (entry.isDirectory() && EXCLUDED_DIRS.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(abs, root, out);
    } else if (entry.isFile()) {
      out.push(path.relative(root, abs).split(path.sep).join("/"));
    }
  }
}

export const definition: ToolDefinition = {
  name: "list_files",
  description:
    "List files in the project, excluding node_modules/.git/dist. Optionally filter with a " +
    "glob pattern (** matches any depth, * within a segment, ? single char, e.g. \"src/**/*.ts\") " +
    "or a plain name, which matches as a case-insensitive substring of the path " +
    "(e.g. \"calc\" finds calc.py, \"session\" finds src/session/store.ts).",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Subdirectory to start from (default: project root)" },
      pattern: { type: "string", description: 'Optional glob ("src/**/*.ts") or plain name ("calc") to filter by' },
    },
  },
  mutating: false,
};

/**
 * Real globs stay exact; a pattern without glob metacharacters is a
 * case-insensitive substring match on the root-relative path. Models pass
 * bare file names ("calc") far more often than globs — treating those as
 * exact-name globs finds nothing and sends the agent guessing.
 */
function matchesPattern(file: string, pattern: string): boolean {
  if (/[*?[]/.test(pattern)) return globToRegex(pattern).test(file);
  return file.toLowerCase().includes(pattern.toLowerCase());
}

export const execute: ToolExecutor = async (input, ctx: ToolContext) => {
  const { path: relDir = ".", pattern } = input as { path?: string; pattern?: string };
  const absDir = resolveWithinRoot(ctx.projectRoot, relDir);
  const all: string[] = [];
  // Walk from absDir, but report paths relative to the PROJECT ROOT — the model
  // feeds these straight into other tools, all of which are root-relative.
  await walk(absDir, ctx.projectRoot, all);
  const files = (pattern ? all.filter((f) => matchesPattern(f, pattern)) : all).sort();
  return {
    output: { files, count: files.length, pattern },
    isError: false,
    summary: pattern
      ? `Found ${files.length} file${files.length === 1 ? "" : "s"} matching "${pattern}"`
      : `Listed ${files.length} file${files.length === 1 ? "" : "s"} under ${relDir}`,
  };
};
