import fs from "node:fs/promises";
import path from "node:path";
import { ToolContext, ToolDefinition, ToolExecutor } from "./types.js";
import { resolveWithinRoot } from "./paths.js";

const EXCLUDED_DIRS = new Set(["node_modules", ".git", "dist", ".anvil"]);
const MAX_FILE_BYTES = 1024 * 1024;

async function* textFiles(dir: string): AsyncGenerator<string> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory() && EXCLUDED_DIRS.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* textFiles(abs);
    } else if (entry.isFile()) {
      yield abs;
    }
  }
}

export const definition: ToolDefinition = {
  name: "grep",
  description:
    "Search all project files for lines matching a regular expression. Returns file path, " +
    "line number, and the matching line.",
  inputSchema: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "JavaScript regular expression source" },
      path: { type: "string", description: "Optional subdirectory to limit the search" },
      maxResults: { type: "number", description: "Stop after this many matches (default 200)" },
    },
    required: ["pattern"],
  },
  mutating: false,
};

export const execute: ToolExecutor = async (input, ctx: ToolContext) => {
  const { pattern, path: relDir = ".", maxResults = 200 } = input as {
    pattern: string;
    path?: string;
    maxResults?: number;
  };
  const absDir = resolveWithinRoot(ctx.projectRoot, relDir);
  let regex: RegExp;
  try {
    regex = new RegExp(pattern);
  } catch (err) {
    return {
      output: { error: `Invalid regular expression: ${(err as Error).message}` },
      isError: true,
      summary: `grep failed: invalid pattern`,
    };
  }

  const matches: Array<{ path: string; line: number; text: string }> = [];
  let truncated = false;
  for await (const abs of textFiles(absDir)) {
    if (matches.length >= maxResults) {
      truncated = true;
      break;
    }
    const buf = await fs.readFile(abs);
    if (buf.length > MAX_FILE_BYTES || buf.includes(0)) continue; // skip big/binary files
    const rel = path.relative(ctx.projectRoot, abs).split(path.sep).join("/");
    const lines = buf.toString("utf8").split("\n");
    for (let i = 0; i < lines.length && matches.length < maxResults; i++) {
      if (regex.test(lines[i])) {
        matches.push({ path: rel, line: i + 1, text: lines[i].slice(0, 300) });
      }
    }
  }
  return {
    output: { matches, truncated },
    isError: false,
    summary: `grep "${pattern}": ${matches.length} match${matches.length === 1 ? "" : "es"}`,
  };
};
