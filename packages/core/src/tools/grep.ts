import fs from "node:fs/promises";
import path from "node:path";
import { ToolContext, ToolDefinition, ToolExecutor } from "./types.js";
import { EXCLUDED_DIRS, resolveWithinRoot } from "./paths.js";

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
  // The cap is enforced per MATCH, not per file: checking only at file
  // boundaries reported truncated=false when the cap was hit inside the LAST
  // scanned file. The cost of honesty — when exactly maxResults matches exist
  // in total, the scan runs to the end to prove nothing was omitted — is
  // bounded by the size gates above.
  scan: for await (const abs of textFiles(absDir)) {
    // Size-gate BEFORE reading: readFile would pull the whole file (any size)
    // into memory just to skip it — a multi-gigabyte log or artifact would
    // spike the heap on every scan.
    try {
      const stat = await fs.stat(abs);
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES) continue;
    } catch {
      continue; // raced unlink/permission — same policy as read failures below
    }
    const buf = await fs.readFile(abs);
    if (buf.includes(0)) continue; // skip binary files
    const rel = path.relative(ctx.projectRoot, abs).split(path.sep).join("/");
    const lines = buf.toString("utf8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (!regex.test(lines[i])) continue;
      if (matches.length >= maxResults) {
        truncated = true;
        break scan; // one proven-omitted match is enough to know
      }
      matches.push({ path: rel, line: i + 1, text: lines[i].slice(0, 300) });
    }
  }
  return {
    output: { matches, truncated },
    isError: false,
    summary: `grep "${pattern}": ${matches.length} match${matches.length === 1 ? "" : "es"}`,
  };
};
