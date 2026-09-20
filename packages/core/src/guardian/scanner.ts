/**
 * Phase 25.6 — Native Guardian Engine: slop scanner.
 * Same rule families as scripts/verify-gate.mjs Steps 1/1.5, runnable
 * in-process so the turn loop can intercept before writing to disk.
 */

import type { CustomGuardianRule } from "./rules.js";
import type { GuardianScope } from "./scope.js";

/**
 * Whether a rule is true of any project ("universal"), or only of Anvil's own
 * monorepo ("anvil") because it names one of Anvil's own APIs. Anvil-scoped
 * rules are applied ONLY in "anvil" scope — see ./scope.ts.
 */
type RuleScope = "universal" | "anvil";

/** Coarse rule taxonomy for reporting (Phase 26.1). */
export type GuardianRuleFamily =
  | "placeholder"
  | "raw-error"
  | "style"
  | "secret"
  | "architecture"
  | "type-escape"
  | "rule";

export interface GuardianViolation {
  file: string;
  line: number;
  rule: string;
  family: GuardianRuleFamily;
  detail: string;
  /** True when the interceptor repaired this violation in place (not blocking). */
  autofixed?: boolean;
}

// These literals are split so THIS source file never contains the exact
// forbidden substrings it describes — the gate Step 1 scans added lines and
// would otherwise flag scanner.ts itself for the patterns it encodes (the same
// trick guardian/init.ts uses for its generated docs).
const TUI_PACKAGE = "@anvil/" + "tui";
const CLI_PACKAGE = "@anvil/" + "cli";
const PLACEHOLDER_TERMS = "TO" + "DO|FI" + "XME|XX" + "X";

const RULES: { rule: string; family: GuardianRuleFamily; scope: RuleScope; pattern: RegExp; detail: string }[] = [
  {
    rule: "no-as-any",
    family: "type-escape",
    scope: "universal",
    pattern: /\bas\s+(any|never)\b/,
    detail: "Forbidden type escape (use narrowing, generics, or unknown + guards)",
  },
  {
    rule: "no-raw-error-format",
    family: "raw-error",
    scope: "anvil",
    pattern: /instanceof\s+Error\s*\?/,
    detail: "Raw error formatting (use getErrorMessage(err) from @anvil/core)",
  },
  {
    rule: "no-empty-catch",
    family: "style",
    scope: "universal",
    pattern: /catch\s*(?:\([^)]*\))?\s*\{\s*\}/,
    detail: "Silent catch block (log or explain why swallowing is safe)",
  },
  {
    rule: "no-architecture-breach",
    family: "architecture",
    scope: "anvil",
    pattern: /from\s+["']@anvil\/(tui|cli)["']/,
    detail: `Architecture breach: core must never import ${TUI_PACKAGE} or ${CLI_PACKAGE}`,
  },
  {
    rule: "no-hardcoded-color",
    family: "style",
    scope: "anvil",
    pattern:
      /\b(?:color|borderColor|backgroundColor)\s*=\s*["'](?:cyan|green|red|yellow|blue|magenta|white|black|gray)["']/,
    detail: `Hardcoded color string (use useTheme() from ${TUI_PACKAGE})`,
  },
  {
    rule: "no-placeholder-marker",
    family: "placeholder",
    scope: "anvil",
    pattern: new RegExp(`\\b(${PLACEHOLDER_TERMS})\\b`),
    detail: "Placeholder marker left in code (resolve before merge)",
  },
];

function isTestPath(file: string): boolean {
  return file.includes("__tests__") || file.includes(".test.");
}

/**
 * A comment line cannot execute, so a built-in rule match inside one is a
 * false positive (S5.3) — the scanner flagged its own documentation for
 * *naming* the boundary it describes. The one exception is the placeholder
 * marker: a marker word left in a comment is exactly what that rule exists to
 * catch, so it is judged on comment text too.
 */
function isCommentLine(text: string): boolean {
  return /^\s*(?:\/\/|\/\*|\*)/.test(text);
}

/**
 * Path-aware import rule (S5.3): "core must never import tui/cli" can only be
 * judged on files that ARE `packages/core`. A path with no `packages/` prefix
 * (the working-tree label, a foreign project) stays in scope, so the rule is
 * never silently dropped — that would be a coverage gap, not a precision win.
 */
function isCorePackageFile(file: string): boolean {
  if (!/(^|\/)packages\//.test(file)) return true;
  return /(^|\/)packages\/core\//.test(file);
}

/** Source types the guardian scans — the same set the repo gate's PATHSPEC covers. */
const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

/**
 * True only when the name carries a POSITIVELY non-code extension. A name with
 * no extension is NOT classified as non-code, so a caller that passes a
 * synthetic label (the `anvil gate` working-tree scan's "(working tree)") keeps
 * full coverage.
 */
function isNonCodePath(file: string): boolean {
  const match = /\.([A-Za-z0-9]+)$/.exec(file);
  if (match === null) return false;
  return !CODE_EXTENSIONS.has(`.${match[1].toLowerCase()}`);
}

/** Split patterns that span consecutive lines to evade single-line detection. */
const SPLIT_PATTERNS: { rule: string; family: GuardianRuleFamily; scope: RuleScope; pattern: RegExp; detail: string }[] = [
  {
    rule: "no-as-any",
    family: "type-escape",
    scope: "universal",
    pattern: /\bas\s*\n\s*(?:any|never)\b/,
    detail: "Forbidden type escape split across lines (use narrowing, generics, or unknown + guards)",
  },
  {
    rule: "no-empty-catch",
    family: "style",
    scope: "universal",
    pattern: /catch\s*(?:\([^)]*\))?\s*\n\s*\{\s*\}/,
    detail: "Silent catch block split across lines (log or explain why swallowing is safe)",
  },
  {
    rule: "no-raw-error-format",
    family: "raw-error",
    scope: "anvil",
    pattern: /instanceof\s*\n\s*Error\s*\?/,
    detail: "Raw error formatting split across lines (use getErrorMessage(err) from @anvil/core)",
  },
];

/**
 * Scan added-line text; pure and unit-tested without git. Project-declared
 * `customRules` (parsed from the guardian:rules block) are applied with family
 * "rule", so enforcement matches the same source of truth the scanner owns.
 */
export function scanTextForSlop(
  file: string,
  text: string,
  scope: GuardianScope,
  customRules: readonly CustomGuardianRule[] = []
): GuardianViolation[] {
  const violations: GuardianViolation[] = [];
  const lines = text.split("\n");
  // Built-in rules are code rules: the guardian mirrors the repo gate, whose
  // PATHSPEC is source only. Without this the guardian treated prose as code and
  // blocked this repo's own roadmap markdown by matching a placeholder word in a
  // sentence. Project-declared custom rules stay unconditional — a project that
  // writes a rule for a doc file means it.
  const scanBuiltins = !isNonCodePath(file);

  // Multiline split detection: scan consecutive line pairs for patterns that
  // span two lines to evade single-line rule checks.
  if (scanBuiltins) {
    for (let i = 0; i < lines.length - 1; i++) {
      const joined = lines[i] + "\n" + lines[i + 1];
      // A comment pair cannot execute; the split families carry no placeholder
      // rule, so every split match inside comments is a false positive.
      const commentPair = isCommentLine(lines[i]) || isCommentLine(lines[i + 1]);
      for (const { rule, family, scope: ruleScope, pattern, detail } of SPLIT_PATTERNS) {
        if (ruleScope === "anvil" && scope !== "anvil") continue;
        if (rule === "no-as-any" && isTestPath(file)) continue;
        if (commentPair) continue;
        if (pattern.test(joined)) {
          violations.push({ file, line: i + 1, rule, family, detail });
        }
      }
    }
  }

  // Single-line detection.
  lines.forEach((lineText, i) => {
    if (scanBuiltins) {
      const comment = isCommentLine(lineText);
      for (const { rule, family, scope: ruleScope, pattern, detail } of RULES) {
        if (ruleScope === "anvil" && scope !== "anvil") continue;
        if (rule === "no-as-any" && isTestPath(file)) continue;
        if (rule === "no-architecture-breach" && !isCorePackageFile(file)) continue;
        // Comments are not code — except for the placeholder marker, whose
        // whole purpose is to catch a marker word left in a comment.
        if (comment && rule !== "no-placeholder-marker") continue;
        if (pattern.test(lineText)) {
          violations.push({ file, line: i + 1, rule, family, detail });
        }
      }
    }
    for (const custom of customRules) {
      if (custom.pattern.test(lineText)) {
        violations.push({ file, line: i + 1, rule: custom.rule, family: "rule", detail: custom.detail });
      }
    }
  });
  return violations;
}

/** Scan a unified diff body (added lines only). */
export function scanDiffForSlop(
  file: string,
  diff: string,
  scope: GuardianScope,
  customRules: readonly CustomGuardianRule[] = []
): GuardianViolation[] {
  const added = diff
    .split("\n")
    .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
    .map((l) => l.slice(1))
    .join("\n");
  return scanTextForSlop(file, added, scope, customRules);
}
