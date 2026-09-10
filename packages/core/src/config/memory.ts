import fs from "node:fs";
import path from "node:path";
import { resolveWithinRoot } from "../tools/paths.js";
import type { ProjectRules } from "./rules.js";

export const MAX_MEMORY_BYTES = 32 * 1024; // 32 KB cap
export const MEMORY_RELATIVE_PATH = ".anvil/memory.md";
export const GITIGNORE_RELATIVE_PATH = ".anvil/.gitignore";

export interface ProjectMemory {
  path: string; // .anvil/memory.md
  content: string;
  sizeBytes: number;
}

/**
 * Loads project memory from .anvil/memory.md if it exists in projectRoot.
 * Capped at MAX_MEMORY_BYTES (32KB). Returns null if file is missing or empty.
 */
export function loadProjectMemory(projectRoot: string): ProjectMemory | null {
  let resolved: string;
  try {
    resolved = resolveWithinRoot(projectRoot, MEMORY_RELATIVE_PATH);
  } catch {
    return null;
  }

  try {
    if (!fs.existsSync(resolved)) return null;
    const stat = fs.statSync(resolved);
    if (!stat.isFile() || stat.size === 0) return null;

    let raw: string;
    if (stat.size > MAX_MEMORY_BYTES) {
      const fd = fs.openSync(resolved, "r");
      try {
        const buf = Buffer.alloc(MAX_MEMORY_BYTES);
        fs.readSync(fd, buf, 0, MAX_MEMORY_BYTES, 0);
        raw = buf.toString("utf8") + "\n[memory truncated at 32KB]";
      } finally {
        fs.closeSync(fd);
      }
    } else {
      raw = fs.readFileSync(resolved, "utf8");
    }

    const trimmed = raw.trim();
    if (!trimmed) return null;

    return {
      path: MEMORY_RELATIVE_PATH,
      content: trimmed,
      sizeBytes: stat.size,
    };
  } catch {
    return null;
  }
}

/**
 * Appends a new entry to .anvil/memory.md with an ISO timestamp header.
 * Auto-creates .anvil/ directory and .anvil/.gitignore to exclude memory.md if needed.
 */
export function appendToMemory(projectRoot: string, entry: string): void {
  const anvilDir = path.join(projectRoot, ".anvil");
  if (!fs.existsSync(anvilDir)) {
    fs.mkdirSync(anvilDir, { recursive: true });
  }

  // Auto-create .anvil/.gitignore to exclude memory.md by default
  const gitignorePath = path.join(anvilDir, ".gitignore");
  if (!fs.existsSync(gitignorePath)) {
    try {
      fs.writeFileSync(gitignorePath, "memory.md\n", "utf8");
    } catch {
      // Non-fatal if gitignore write fails
    }
  }

  const memoryFile = path.join(projectRoot, MEMORY_RELATIVE_PATH);
  const timestamp = new Date().toISOString();
  const fileExists = fs.existsSync(memoryFile);
  const prefix = fileExists ? "\n\n" : "";
  const header = `### [${timestamp}]\n`;
  const text = `${prefix}${header}${entry.trim()}\n`;

  fs.appendFileSync(memoryFile, text, "utf8");
}

/**
 * Combines base system prompt with project rules and project memory.
 * System prompt injection order:
 *   <base system prompt>
 *   [Project-specific rules from <source>]
 *   <rules content>
 *   [Project memory from .anvil/memory.md]
 *   <memory content>
 */
export function buildSystemPromptWithMemory(
  basePrompt: string,
  projectRoot: string,
  rules: ProjectRules | null,
  memory: ProjectMemory | null
): string {
  let prompt = basePrompt;

  if (rules && rules.content) {
    prompt += `\n\n[Project-specific rules from ${rules.source}]\n${rules.content}`;
  }

  if (memory && memory.content) {
    prompt += `\n\n[Project memory from ${memory.path}]\n${memory.content}`;
  }

  return prompt;
}
