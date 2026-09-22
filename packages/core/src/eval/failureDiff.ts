import fs from "node:fs";
import path from "node:path";
import { createTwoFilesPatch } from "diff";
import { EVAL_FAILURE_DIFF_MAX_CHARS } from "../config/constants.js";

/**
 * Phase 27.3 — failure diff snapshots. When an eval task fails, the interesting
 * artifact is WHAT THE MODEL WROTE, which used to be discarded with the temp
 * sandbox (only exit code + stderr survived). This compares the pristine task
 * setup against the post-run workspace and returns one unified diff.
 *
 * No git dependency: the eval fixtures are plain directories, so a file-tree
 * comparison is both simpler and works in any sandbox.
 */

const SKIP_DIRS = new Set(["node_modules", ".git"]);

function listFiles(dir: string, base = dir, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      listFiles(path.join(dir, entry.name), base, out);
    } else {
      out.push(path.relative(base, path.join(dir, entry.name)));
    }
  }
  return out;
}

/** Text of a file, or null when it is absent/unreadable (treated as absent). */
function readText(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    // intentional: an unreadable/gone file is reported as "no such file", not a crash
    return null;
  }
}

/**
 * Unified diff between `setupDir` (pristine) and `workDir` (post-run), covering
 * edits, creations and deletions. Returns "" when nothing changed. Capped at
 * `maxChars` so a huge generated file cannot bloat the report.
 */
export function captureFailureDiff(
  setupDir: string,
  workDir: string,
  maxChars: number = EVAL_FAILURE_DIFF_MAX_CHARS
): string {
  const files = [...new Set([...listFiles(setupDir), ...listFiles(workDir)])].sort();
  const parts: string[] = [];
  for (const rel of files) {
    const oldText = readText(path.join(setupDir, rel));
    const newText = readText(path.join(workDir, rel));
    if (oldText === newText) continue;
    parts.push(
      createTwoFilesPatch(`a/${rel}`, `b/${rel}`, oldText ?? "", newText ?? "", "", "", { context: 3 })
    );
  }
  if (parts.length === 0) return "";
  const joined = parts.join("");
  if (joined.length <= maxChars) return joined;
  return `${joined.slice(0, maxChars)}\n[diff truncated at ${maxChars} chars]`;
}
