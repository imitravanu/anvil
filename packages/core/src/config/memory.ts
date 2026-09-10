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
        // Keep the NEWEST slice of the memory: entries are appended at the
        // tail, so reading the file head would silently hide the most recent
        // knowledge from the model while the file itself keeps growing.
        // (Write-side capping in appendToMemory prevents growth past the cap,
        // but hand-edited or legacy files can still exceed it.)
        fs.readSync(fd, buf, 0, MAX_MEMORY_BYTES, stat.size - MAX_MEMORY_BYTES);
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
 * Enforces MAX_MEMORY_BYTES on write: when an append would exceed the cap, the
 * OLDEST entries are dropped (newest-first retention) so the file never outgrows
 * the cap and the read side never needs to hide recent knowledge.
 * Throws if the entry alone exceeds the cap — refusing beats silently corrupting.
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
  const header = `### [${timestamp}]\n`;
  const newSection = `${header}${entry.trim()}\n`;

  if (Buffer.byteLength(newSection, "utf8") > MAX_MEMORY_BYTES) {
    throw new Error(
      `Memory entry alone exceeds the ${MAX_MEMORY_BYTES}-byte cap — store a shorter note.`
    );
  }

  const fileExists = fs.existsSync(memoryFile);
  const existing = fileExists ? fs.readFileSync(memoryFile, "utf8") : "";
  const appended = `${fileExists ? "\n\n" : ""}${newSection}`;

  if (Buffer.byteLength(existing, "utf8") + Buffer.byteLength(appended, "utf8") <= MAX_MEMORY_BYTES) {
    fs.appendFileSync(memoryFile, appended, "utf8");
    return;
  }

  // Over cap: rebuild keeping only the newest sections that fit (oldest
  // dropped). Section separators are "\n\n"; the final content is
  //   kept[0] \n\n kept[1] \n\n … \n\n newSection
  const sections = splitMemorySections(existing);
  // total tracks (bytes of kept sections so far + one separator each) plus
  // the trailing separator before newSection. Greedy, newest-first.
  let total = Buffer.byteLength(newSection, "utf8");
  const kept: string[] = []; // newest-first accumulation
  for (let i = sections.length - 1; i >= 0; i--) {
    const sectionBytes = Buffer.byteLength(sections[i], "utf8");
    if (total + sectionBytes + 2 > MAX_MEMORY_BYTES) break;
    total += sectionBytes + 2;
    kept.push(sections[i]); // sections[i] is older than what's already kept
  }
  const rewritten =
    kept.length > 0 ? `${kept.reverse().join("\n\n")}\n\n${newSection}` : newSection;
  fs.writeFileSync(memoryFile, rewritten, "utf8");
}

/** Section header line begins a new entry. Files written by us always start
 * with one; legacy/hand-edited content without any header is one section. */
const SECTION_HEADER_RE = /^### \[/;

function splitMemorySections(content: string): string[] {
  const sections: string[] = [];
  let current: string | null = null;
  for (const line of content.split("\n")) {
    if (SECTION_HEADER_RE.test(line)) {
      if (current !== null) sections.push(current);
      current = line;
    } else if (current !== null) {
      current += "\n" + line;
    }
  }
  if (current !== null && current.trim().length > 0) sections.push(current);
  return sections;
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
