import fs from "node:fs/promises";
import path from "node:path";
import { ToolContext, ToolDefinition, ToolExecutor } from "./types.js";
import { EXCLUDED_DIRS, resolveWithinRoot } from "./paths.js";

const MAX_FILE_BYTES = 1024 * 1024;

// Model-supplied patterns run in a synchronous regex engine that Esc/cancel
// cannot interrupt: a pathological shape would freeze the whole app mid-turn.
// Two independent bounds keep worst-case work sane:
// 1. GREP_LINE_TEST_MAX — each line is only tested on its first 4 KB. Lines in
//    real source are far shorter; minified bundles live under dist/.git etc.
//    (EXCLUDED_DIRS), and a long-line note is surfaced honestly in the output.
// 2. A pre-flight shape check (grepPatternError) rejects the classic
//    catastrophic-backtracking class: a repeated group whose body contains
//    its own repetition or alternation — e.g. (a|aa)+$ hangs a 38-character
//    line for >60s on Node 24 (verified); (?:ab)+ (fixed text, no alternation)
//    and plain alternation (a|b) without an outer repeat stay allowed.
export const GREP_PATTERN_MAX_LENGTH = 256;
export const GREP_LINE_TEST_MAX = 4096;

/**
 * Structural view of a pattern for the shape check. Escaped atoms and
 * character classes become single placeholder tokens (they are atoms, so a
 * quantifier after them belongs to the atom, never to a closing group);
 * parens, alternation, and quantifiers stay visible.
 */
function structuralTokens(src: string): string {
  let out = "";
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === "\\") {
      out += "\u0001"; // escaped atom placeholder
      i += 1;
      continue;
    }
    if (ch === "[") {
      i += 1;
      while (i < src.length && src[i] !== "]") {
        if (src[i] === "\\") i += 1;
        i += 1;
      }
      out += "\u0002"; // character-class placeholder
      continue;
    }
    out += ch;
  }
  return out;
}

/** True when the token at `i` is an UNBOUNDED quantifier (*, +, {n,} or {,}). */
function isUnboundedQuantifier(tokens: string, i: number): boolean {
  const ch = tokens[i];
  if (ch === "*" || ch === "+") return true;
  if (ch !== "{") return false;
  const close = tokens.indexOf("}", i + 1);
  if (close === -1) return false; // malformed — new RegExp reports it below
  const body = tokens.slice(i + 1, close);
  // {n,} / {,} repeat without an upper bound; {n} and {n,m} are bounded.
  return /^\s*\d*,\s*$/.test(body);
}

/** Rejection reason, or null when the pattern is safe to search with. */
export function grepPatternError(pattern: string): string | null {
  if (pattern.length === 0) return "Pattern is empty.";
  if (pattern.length > GREP_PATTERN_MAX_LENGTH) {
    return `Pattern exceeds the ${GREP_PATTERN_MAX_LENGTH}-character safety limit.`;
  }
  const tokens = structuralTokens(pattern);
  const stack: number[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] === "(") {
      stack.push(i);
      continue;
    }
    if (tokens[i] !== ")") continue;
    if (stack.length === 0) continue; // unmatched — new RegExp reports it below
    const open = stack.pop() as number;
    // Only an UNBOUNDED repeat of the group is the explosive shape; bounded
    // repeats ({2}, {2,3}) are linear.
    if (!isUnboundedQuantifier(tokens, i + 1)) continue;
    // Non-capturing / lookaround / named-group prefixes are not alternation.
    let body = tokens.slice(open + 1, i);
    body = body.replace(/^\?(?::|=|!|<[=!]|<[A-Za-z_][A-Za-z0-9_]*>)/, "");
    // A body containing its own unbounded repetition or an alternation is the
    // classic catastrophic-backtracking shape (verified: (a|aa)+$ hangs Node
    // for >6s on a 38-character line).
    let dangerous = false;
    for (let j = 0; j < body.length; j++) {
      const bch = body[j];
      if (bch === "|" || bch === "*" || bch === "+" || bch === "?") {
        dangerous = true;
        break;
      }
      if (bch === "{") {
        // Exact {n} collapses to one fixed-length atom (safe when the group
        // repeats); a RANGE {n,m} / {n,} lets the body match many lengths,
        // which tiles exponentially under an unbounded group repeat.
        const close = body.indexOf("}", j + 1);
        if (close !== -1 && !/^\s*\d+\s*$/.test(body.slice(j + 1, close))) {
          dangerous = true;
          break;
        }
      }
    }
    if (dangerous) {
      return "Unsafe pattern: an unboundedly-repeated group can match multiple lengths (alternation or variable repetition inside), which can hang the search. Try a simpler pattern.";
    }
  }
  return null;
}

async function* textFiles(dir: string, signal?: AbortSignal): AsyncGenerator<string> {
  if (signal?.aborted) return;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (signal?.aborted) return;
    if (entry.isDirectory() && EXCLUDED_DIRS.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* textFiles(abs, signal);
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
  const { pattern, path: relDir = ".", maxResults = 200 } = (input ?? {}) as {
    pattern?: string;
    path?: string;
    maxResults?: number;
  };
  if (typeof pattern !== "string" || !pattern) {
    return {
      output: { error: "grep requires a non-empty string argument: pattern" },
      isError: true,
      summary: "grep failed: missing required pattern",
    };
  }
  const absDir = resolveWithinRoot(ctx.projectRoot, typeof relDir === "string" ? relDir : ".");
  const unsafe = grepPatternError(pattern);
  if (unsafe !== null) {
    return {
      output: { error: `Unsuitable grep pattern: ${unsafe}` },
      isError: true,
      summary: `grep failed: ${unsafe}`,
    };
  }
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
  let longLines = 0;
  // The cap is enforced per MATCH, not per file: checking only at file
  // boundaries reported truncated=false when the cap was hit inside the LAST
  // scanned file. The cost of honesty — when exactly maxResults matches exist
  // in total, the scan runs to the end to prove nothing was omitted — is
  // bounded by the size gates above.
  scan: for await (const abs of textFiles(absDir, ctx.signal)) {
    if (ctx.signal.aborted) {
      return {
        output: { matches, truncated: true, aborted: true },
        isError: true,
        summary: `grep cancelled`,
      };
    }
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
      // Regex testing is synchronous and uninterruptible; bound each test to
      // the line's first GREP_LINE_TEST_MAX chars so even a pattern that slips
      // past the shape check operates on small input. Lines longer than the
      // bound still report honestly via longLines below.
      const line = lines[i];
      const tested = line.length > GREP_LINE_TEST_MAX ? line.slice(0, GREP_LINE_TEST_MAX) : line;
      if (tested !== line) longLines += 1;
      if (!regex.test(tested)) continue;
      if (matches.length >= maxResults) {
        truncated = true;
        break scan; // one proven-omitted match is enough to know
      }
      matches.push({ path: rel, line: i + 1, text: line.slice(0, 300) });
    }
  }
  return {
    output: {
      matches,
      truncated,
      ...(longLines > 0
        ? { note: `${longLines} very long line${longLines === 1 ? "" : "s"} searched only in their first ${GREP_LINE_TEST_MAX} characters` }
        : {}),
    },
    isError: false,
    summary: `grep "${pattern}": ${matches.length} match${matches.length === 1 ? "" : "es"}`,
  };
};
