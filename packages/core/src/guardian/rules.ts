import { loadProjectRules } from "../config/rules.js";

/**
 * Phase 26.0 — project-rules → scanner bridge.
 * Machine-enforceable rules a project declares in a structured block are
 * parsed here and handed to the scanner, turning user advice into enforcement.
 */
export interface CustomGuardianRule {
  rule: string;
  pattern: RegExp;
  detail: string;
}

/** Upper bound so a runaway rules block can't make every scan quadratic. */
export const MAX_CUSTOM_RULES = 32;

/** The declared block: `<!-- guardian:rules ... -->`. */
const BLOCK_RE = /<!--\s*guardian:rules\s*([\s\S]*?)-->/;
/** One entry: `name: /pattern/ : "detail"`. */
const ENTRY_RE = /^\s*([A-Za-z0-9_-]+)\s*:\s*\/(.+)\/\s*:\s*"([^"]*)"\s*$/;

/**
 * Parse the `<!-- guardian:rules ... -->` block from already-loaded rules
 * content. Pure. Malformed lines are skipped, never thrown — one bad entry
 * must not disable the rest.
 */
export function parseCustomGuardianRules(content: string): CustomGuardianRule[] {
  const block = content.match(BLOCK_RE);
  if (!block) return [];
  const rules: CustomGuardianRule[] = [];
  for (const line of block[1].split("\n")) {
    if (!line.trim()) continue;
    if (rules.length >= MAX_CUSTOM_RULES) break;
    const m = line.match(ENTRY_RE);
    if (!m) continue;
    try {
      rules.push({ rule: m[1], pattern: new RegExp(m[2]), detail: m[3] });
    } catch {
      // intentional: an invalid regex in a rules file is skipped, not fatal
    }
  }
  return rules;
}

/**
 * Load and parse project-declared machine-enforceable rules. Source precedence
 * is `loadProjectRules` (.anvil/rules → AGENTS.md → .cursorrules). Reads are
 * bounded by that loader; this adds only parsing.
 */
export function loadCustomGuardianRules(projectRoot: string): CustomGuardianRule[] {
  const rules = loadProjectRules(projectRoot);
  if (!rules) return [];
  return parseCustomGuardianRules(rules.content);
}
