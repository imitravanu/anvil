import { loadProjectRules } from "../config/rules.js";
import { MAX_CUSTOM_RULES, MAX_CUSTOM_RULE_INPUT_CHARS } from "../config/constants.js";

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

/** Upper bound so a runaway rules block can't make every scan quadratic.
 * Centralized in config/constants (§2.4); re-exported so the public API is unchanged. */
export { MAX_CUSTOM_RULES, MAX_CUSTOM_RULE_INPUT_CHARS };

/**
 * The top-level alternatives of a group body: `|` separators that are neither
 * escaped nor inside a character class nor inside a nested group. `a|(b|c)` has
 * two alternatives, not three. Pure.
 */
function splitAlternatives(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let inClass = false;
  let current = "";
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === "\\") {
      current += ch + (body[i + 1] ?? "");
      i++;
      continue;
    }
    if (inClass) {
      if (ch === "]") inClass = false;
      current += ch;
      continue;
    }
    if (ch === "[") inClass = true;
    else if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "|" && depth === 0) {
      out.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  out.push(current.trim());
  return out;
}

/**
 * A branch with the grouping syntax it carries removed, so `?:a` compares equal
 * to `a` and `(?:aa)` to `aa`. Without this, the common non-capturing spelling
 * of an ambiguous alternation (`(?:a|aa)+`) reads as two disjoint branches.
 */
function normalizeBranch(branch: string): string {
  let b = branch.startsWith("?:") ? branch.slice(2) : branch;
  if (b.startsWith("(") && b.endsWith(")")) {
    b = b.slice(1, -1);
    if (b.startsWith("?:")) b = b.slice(2);
  }
  return b;
}

/**
 * Whether two alternatives of the same group can consume the same prefix - the
 * ambiguity that makes a `+`/`*` repetition of them backtrack exponentially
 * (`a|aa`, `\w|\w\w`, `get|getters`). Disjoint branches (`foo|bar`, `a|b`) stay
 * allowed, since one can never match text the other also matches. An empty or
 * duplicated branch is ambiguous by construction. Pure.
 */
function alternativesOverlap(branches: readonly string[]): boolean {
  for (let i = 0; i < branches.length; i++) {
    for (let j = i + 1; j < branches.length; j++) {
      const a = normalizeBranch(branches[i]);
      const b = normalizeBranch(branches[j]);
      if (a === "" || b === "" || a === b) return true;
      if (a.startsWith(b) || b.startsWith(a)) return true;
    }
  }
  return false;
}

/**
 * ReDoS guard. A quantified group that can match the same text in more than one
 * way backtracks exponentially on a near-miss input, and two families do it:
 *
 *  - a quantifier applied to a group that already contains one - `(a+)+`,
 *    `(a*)*`, `(.*a){12}`, `(a|a?)+` (measured at ~14s on a 29-char line);
 *  - a quantifier applied to a group whose ALTERNATIVES overlap, i.e. one branch
 *    can consume a prefix another branch could also consume - `(a|aa)+`,
 *    `(\w|\w\w)+`, `(get|getters)+`. 2026-10-14: the check above was blind to
 *    this family, and `(\w|\w\w)+$` - which reads as "lines must end in a word
 *    character" - hung the scanner for >40s on ONE ordinary 50-character source
 *    line. Bounding the scanned line is no defence: the blowup starts around 50
 *    characters, far below MAX_CUSTOM_RULE_INPUT_CHARS.
 *
 * The check is a conservative shape test, not a regex parser: it rejects both
 * families outright and keeps ordinary rules working. Over-rejecting costs a
 * skipped rule, never a hung agent.
 */
export function isCatastrophicPattern(source: string): boolean {
  // Stack of open groups: where each body started (so a closed group's
  // alternatives can be inspected) and whether it holds a quantifier. Escapes
  // and character classes are skipped so `\(` or `[(]` is not a group.
  const stack: { start: number; hasQuantifier: boolean }[] = [];
  let inClass = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === "\\") {
      i++; // the escaped character is literal
      continue;
    }
    if (inClass) {
      if (ch === "]") inClass = false;
      continue;
    }
    if (ch === "[") {
      inClass = true;
      continue;
    }
    if (ch === "(") {
      stack.push({ start: i, hasQuantifier: false });
      continue;
    }
    if (ch === ")") {
      const group = stack.pop();
      if (!group) continue;
      // A quantifier right after the group is what makes EITHER family explode,
      // so it is checked once for both.
      const quantified = /^(?:[+*?]|\{\d+(?:,\d*)?\})/.test(source.slice(i + 1));
      if (quantified) {
        if (group.hasQuantifier) return true;
        const branches = splitAlternatives(source.slice(group.start + 1, i));
        if (branches.length > 1 && alternativesOverlap(branches)) return true;
      }
      if (stack.length > 0 && group.hasQuantifier) stack[stack.length - 1].hasQuantifier = true;
      continue;
    }
    if (ch === "+" || ch === "*" || ch === "?" || ch === "{") {
      // `?` directly after `(` is group syntax, not a quantifier.
      const prev = source[i - 1];
      if (ch === "?" && prev === "(") continue;
      if (ch === "{" && !/^\{\d+(?:,\d*)?\}/.test(source.slice(i))) continue;
      if (stack.length > 0) stack[stack.length - 1].hasQuantifier = true;
    }
  }
  return false;
}

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
      // ReDoS: refuse the exponential shape before it can ever run on a line.
      if (isCatastrophicPattern(m[2])) continue;
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
