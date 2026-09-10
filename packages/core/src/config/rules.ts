import fs from "node:fs";
import { resolveWithinRoot } from "../tools/paths.js";

export const MAX_RULES_BYTES = 16 * 1024; // 16 KB cap

export const RULE_CANDIDATES = [
  ".anvil/rules",
  "AGENTS.md",
  ".cursorrules",
] as const;

export interface ProjectRules {
  source: string;
  content: string;
}

/**
 * Discover project-specific rules in the projectRoot in order of precedence:
 * 1. .anvil/rules
 * 2. AGENTS.md
 * 3. .cursorrules
 *
 * Reads bounded to MAX_RULES_BYTES. Non-existent or empty files return null.
 */
export function loadProjectRules(projectRoot: string): ProjectRules | null {
  for (const candidate of RULE_CANDIDATES) {
    let resolved: string;
    try {
      resolved = resolveWithinRoot(projectRoot, candidate);
    } catch {
      continue;
    }

    try {
      if (!fs.existsSync(resolved)) continue;
      const stat = fs.statSync(resolved);
      if (!stat.isFile() || stat.size === 0) continue;

      let raw: string;
      if (stat.size > MAX_RULES_BYTES) {
        const fd = fs.openSync(resolved, "r");
        try {
          const buf = Buffer.alloc(MAX_RULES_BYTES);
          fs.readSync(fd, buf, 0, MAX_RULES_BYTES, 0);
          raw = buf.toString("utf8") + "\n[rules truncated at 16KB]";
        } finally {
          fs.closeSync(fd);
        }
      } else {
        raw = fs.readFileSync(resolved, "utf8");
      }

      const trimmed = raw.trim();
      if (!trimmed) continue;

      return {
        source: candidate,
        content: trimmed,
      };
    } catch {
      // Unreadable file is ignored so boot never fails
      continue;
    }
  }

  return null;
}

import { loadProjectMemory, buildSystemPromptWithMemory } from "./memory.js";

/**
 * Injects project-specific rules and project memory into the base system prompt.
 */
export function buildSystemPrompt(basePrompt: string, projectRoot: string): string {
  const rules = loadProjectRules(projectRoot);
  const memory = loadProjectMemory(projectRoot);
  return buildSystemPromptWithMemory(basePrompt, projectRoot, rules, memory);
}

