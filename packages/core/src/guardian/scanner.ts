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
const TS_SUPPRESSION_TERMS = "@" + "ts-(?:ignore|nocheck)\\b";
const TEST_SKIP_PATTERN = "\\b(?:it|test|describe)\\.skip\\b|\\b(?:xit|xtest|xdescribe)\\s*\\(";
// H1 (AUDIT-2026-09-30): inline timeout/retry/cap literals (rule 2.4). Written
// as a string so this file never contains the literal shapes it flags.
// A `0` delay is the standard yield-to-event-loop idiom (`setTimeout(fn, 0)`),
// not an arbitrary timeout — `[1-9]` keeps the positive-number cases and drops
// that false positive (found live against an eval fixture's own test harness).
// The third alternative covers the EXPRESSION shape: a retry schedule written
// as one arithmetic expression has no assignment for the forms above to anchor
// on, so its inline exponent base used to be invisible to rule 2.4.
const MAGIC_TIMEOUT_TERMS =
  "(?:timeout|timeoutMs|idleMs|maxWaitMs|maxBuffer|retries|maxRetries|delayMs|debounceMs|intervalMs)\\s*[:=]\\s*[1-9][\\d_]*|set(?:Timeout|Interval)\\s*\\([^,]+,\\s*[1-9][\\d_]*|Math\\.pow\\(\\s*[0-9][\\d_]*";

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
      /\b(?:color|borderColor|backgroundColor)\s*=\s*(?:\{[ \t]*[`](?:cyan|green|red|yellow|blue|magenta|white|black|gray)[`][ \t]*\}|["'](?:cyan|green|red|yellow|blue|magenta|white|black|gray)["']|[`](?:cyan|green|red|yellow|blue|magenta|white|black|gray)[`])/,
    detail: `Hardcoded color string (use useTheme() from ${TUI_PACKAGE})`,
  },
  {
    rule: "no-placeholder-marker",
    family: "placeholder",
    scope: "anvil",
    pattern: new RegExp(`\\b(${PLACEHOLDER_TERMS})\\b`),
    detail: "Placeholder marker left in code (resolve before merge)",
  },
  {
    rule: "no-ts-suppression",
    family: "type-escape",
    scope: "universal",
    pattern: new RegExp(TS_SUPPRESSION_TERMS),
    detail: "TypeScript suppression (@" + "ts-ignore/@" + "ts-nocheck forbidden; fix the underlying types)",
  },
  {
    rule: "no-as-error",
    family: "raw-error",
    scope: "anvil",
    pattern: /\bas\s+Error\b/,
    detail: "Raw error narrowing (use getErrorMessage(err) from @anvil/core or a type guard)",
  },
  {
    rule: "no-magic-constant",
    family: "style",
    scope: "anvil",
    pattern: new RegExp(MAGIC_TIMEOUT_TERMS),
    detail: "Inline timeout/retry/cap literal (import from @anvil/core config/constants)",
  },
  {
    rule: "no-skipped-test",
    family: "style",
    scope: "universal",
    pattern: new RegExp(TEST_SKIP_PATTERN),
    detail: "Skipped test case (a skipped it/test/describe block, or xit/xtest/xdescribe; tests must pass)",
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

function isTuiComponentFile(file: string): boolean {
  if (!/(^|\/)packages\//.test(file)) return true;
  return /(^|\/)packages\/tui\/src\/components\//.test(file);
}

/** Source types the guardian scans — the same set the repo gate's PATHSPEC covers. */
// AUDIT-08: named distinctly from tools/outline.ts's own (different) set.
const GUARDIAN_CODE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

/**
 * True only when the name carries a POSITIVELY non-code extension. A name with
 * no extension is NOT classified as non-code, so a caller that passes a
 * synthetic label (the `anvil gate` working-tree scan's "(working tree)") keeps
 * full coverage.
 */
function isNonCodePath(file: string): boolean {
  const match = /\.([A-Za-z0-9]+)$/.exec(file);
  if (match === null) return false;
  return !GUARDIAN_CODE_EXTENSIONS.has(`.${match[1].toLowerCase()}`);
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
    pattern: /catch\s*(?:\([^)]*\))?\s*\{[ \t\r\n]*\}/,
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
 * True when a catch body neither surfaces the error nor explains itself. The
 * body is compliant if it contains any of these tokens (case-insensitive), or
 * any comment. Empty bodies are the dedicated `no-empty-catch` rule's job.
 */
const CATCH_SURFACES = /log\.|console\.|printSystemMessage|getErrorMessage|throw\b|error|problem|fail|warn|\/\/|\/\*/i;

function matchBraceBody(text: string, openIdx: number): string {
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) return text.slice(openIdx + 1, i);
    }
  }
  return text.slice(openIdx + 1);
}

/** Line numbers of non-empty catch blocks with no log and no rationale (H1). */
function silentCatchLineNumbers(text: string): number[] {
  const out: number[] = [];
  const re = /catch\s*(?:\([^)]*\))?\s*\{/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    // A comment that merely NAMES a catch (docs/explanations) is not code.
    const lineStart = text.lastIndexOf("\n", m.index) + 1;
    const lineEnd = text.indexOf("\n", m.index);
    const line = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd);
    if (/^\s*(?:\/\/|\*|\/\*)/.test(line) || text.slice(lineStart, m.index).includes("//")) continue;
    const openIdx = text.indexOf("{", m.index);
    const body = matchBraceBody(text, openIdx);
    if (body.trim() === "") continue;
    if (CATCH_SURFACES.test(body)) continue;
    out.push(text.slice(0, m.index).split("\n").length);
  }
  return out;
}

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
        if (rule === "no-as-error" && isTestPath(file)) continue;
        if (rule === "no-ts-suppression" && isTestPath(file)) continue;
        if (rule === "no-skipped-test" && !isTestPath(file)) continue;
        if (rule === "no-architecture-breach" && !isCorePackageFile(file)) continue;
        if (rule === "no-hardcoded-color" && !isTuiComponentFile(file)) continue;
        if (rule === "no-magic-constant" && /^[`'"]/.test(lineText.trim())) continue;
        // Comments are not code — except for placeholder marker and ts-suppression,
        // whose whole purpose is to catch markers/suppressions written in comments.
        if (comment && rule !== "no-placeholder-marker" && rule !== "no-ts-suppression") continue;
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

  // H1: brace-aware non-empty silent catches. Tests are exempt (fixtures).
  // Anvil scope only: unlike a truly empty catch, a non-empty silent catch is
  // an ordinary defensive fallback idiom in foreign code, and blocking it would
  // make the guardian unusable outside this repo (the same reason
  // no-raw-error-format is anvil-scoped).
  if (scanBuiltins && scope === "anvil" && !isTestPath(file)) {
    for (const lineNo of silentCatchLineNumbers(text)) {
      violations.push({
        file,
        line: lineNo,
        rule: "no-silent-catch",
        family: "style",
        detail: "Silent catch block with no log or rationale (log, or add // intentional: <reason>)",
      });
    }
  }
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
