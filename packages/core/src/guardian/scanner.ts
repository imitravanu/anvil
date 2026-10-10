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
    rule: "no-bare-any",
    family: "type-escape",
    scope: "universal",
    // Batch O: the gate Step 1 bare-annotation family (Rule 2.2) — the four
    // ANNOTATION positions a cast rule cannot see (colon, generic, comma,
    // array). Batch O+ (chief-engineer takeover, 2026-10-10): the array
    // position is the authority's EMPTY pair — an indexed access
    // (`conf.any[0]`) is property access, not an annotation, and the `any[`
    // transcription refused it on source paths while the gate blessed it.
    // Split so this source file never contains a literal instance of the
    // shape it describes.
    pattern: new RegExp("(?<!\\?):\\s*" + "any\\b|<\\s*" + "any\\b|,\\s*" + "any\\b|\\b" + "any\\s*\\[\\]"),
    detail: "Bare any annotation (use unknown + narrowing)",
  },
  {
    rule: "no-raw-error-format",
    family: "raw-error",
    scope: "anvil",
    // Batch O: both shapes the gate Step 1 labels Raw error formatting — the
    // ternary and the nullish fallback.
    pattern: /instanceof\s+Error\s*\?|\.\s*message\s*\?\?\s*String\s*\(/,
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

/**
 * TEST-FILE EXEMPTION POLICY (Batch N) — ONE policy, every checkpoint.
 *
 * A TEST path (any path containing `__tests__` or `.test.`) is judged by the
 * skipped-test rule ALONE. Every other built-in rule is exempt there because a
 * fixture legitimately needs casts, silent-catch blocks, marker strings and
 * inline timing literals to reproduce the failure it pins. The authority is the
 * gate's Step 1 (`scripts/verify-gate.mjs`); the pre-commit hook (Layer B) and
 * this scanner are PRE-FLIGHTS of it, not second opinions, so all three must
 * answer the same way for the same path (the gate's Step 1.5 residual pass
 * encodes the same split through its `onlyTests` rule flag). The drift test in
 * `packages/cli/src/__tests__/gate.sentinel.test.ts` fails if any of the three
 * diverges.
 *
 * This scanner used to carry its own, narrower exemption: it judged empty
 * catches, raw error formatting, placeholder markers, magic literals, core
 * boundary imports and TUI colors in test files the gate accepted, so the
 * in-process checkpoint nagged about work the commit gate blessed. Project-
 * declared custom rules stay unconditional in every path — a project that
 * writes a rule for a file means it everywhere.
 */
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
 * no extension is NOT classified as non-code, so an unlabeled fallback section
 * (see `scanUnifiedDiffForSlop`) keeps full coverage instead of being read as
 * prose.
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

  const testFile = isTestPath(file);

  // Multiline split detection: scan consecutive line pairs for patterns that
  // span two lines to evade single-line rule checks. The split families are
  // all non-skipped-test rules, so a test path is exempt from this pass
  // entirely — exactly as the gate's Step 1 pair scan skips test paths.
  if (scanBuiltins && !testFile) {
    for (let i = 0; i < lines.length - 1; i++) {
      const joined = lines[i] + "\n" + lines[i + 1];
      // A comment pair cannot execute; the split families carry no placeholder
      // rule, so every split match inside comments is a false positive.
      const commentPair = isCommentLine(lines[i]) || isCommentLine(lines[i + 1]);
      for (const { rule, family, scope: ruleScope, pattern, detail } of SPLIT_PATTERNS) {
        if (ruleScope === "anvil" && scope !== "anvil") continue;
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
        // TEST-FILE EXEMPTION POLICY (see isTestPath): a test path is judged by
        // the skipped-test rule alone; every other path by every other rule.
        if (testFile ? rule !== "no-skipped-test" : rule === "no-skipped-test") continue;
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

  // H1: brace-aware non-empty silent catches. Test paths are exempt by the
  // policy above (fixtures) — and the gate's residual pass does the same.
  // Anvil scope only: unlike a truly empty catch, a non-empty silent catch is
  // an ordinary defensive fallback idiom in foreign code, and blocking it would
  // make the guardian unusable outside this repo (the same reason
  // no-raw-error-format is anvil-scoped).
  if (scanBuiltins && scope === "anvil" && !testFile) {
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

/** Scan a unified diff body (added lines only) for ONE known file. */
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

/** One added line of a unified diff, at the line number it will occupy in the NEW file. */
export interface DiffAddedLine {
  line: number;
  text: string;
}

/** Added lines grouped per file; `file` is the path git printed (`b/` stripped). */
export interface DiffFileSection {
  file: string;
  added: DiffAddedLine[];
}

/**
 * `@@ -oldStart,oldCount +newStart,newCount @@` — group 1 is the new-file
 * start, group 2 the new-file count (absent means 1). The count drives hunk
 * exhaustion in `parseUnifiedDiffSections` (see its Batch O+ header note).
 */
const HUNK_HEADER_RE = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

/**
 * A `+++` header's path: strip a tab-appended timestamp, unquote git's C-style
 * quoting for unusual paths, drop the `a/`/`b/` prefix, and treat `/dev/null`
 * (a deletion) as "no file".
 */
function diffHeaderPath(raw: string): string {
  let value = raw.trim();
  const tab = value.indexOf("\t");
  if (tab !== -1) value = value.slice(0, tab);
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    value = value.slice(1, -1).replace(/\\(["\\])/g, "$1");
  }
  if (value === "/dev/null") return "";
  if (value.startsWith("b/") || value.startsWith("a/")) value = value.slice(2);
  return value;
}

/**
 * Split a unified diff into per-file added lines at their REAL new-file line
 * numbers.
 *
 * Batch O: the in-product `anvil gate` used to hand a whole multi-file diff to
 * the scanner under ONE synthetic label. Everything the scanner decides per
 * PATH then saw that label instead of a path — the test-file exemption, the
 * core boundary and the TUI color rule were all judged against it — and a
 * reported line was an index into the concatenated added text, not a line in a
 * file. Resolution lives HERE, in front of the scanner, so one authority
 * decides what each added line is.
 *
 * Batch O+ (chief-engineer takeover, 2026-10-10): a `+++`-shaped line INSIDE a
 * hunk is ADDED CONTENT, not a file header. Git renders an added line whose own
 * text begins "++ " as exactly "+++ …", shape-identical to a header; honoring it
 * there swallowed the line and re-attributed every later added line of the real
 * file to a phantom path with restarted line numbers. A `+++` line is a header
 * only once the current hunk's new-file lines are exhausted (`newSideLeft`) —
 * git's exact hunk counts make that precise for real diffs, and the hunk-less
 * synthetic sections (the authority's untracked-file shape) carry no `@@`
 * header at all, so their `+++` lines stay headers. Deletion-only hunks open at
 * 0, which is safe: `+` lines cannot exist inside them.
 *
 * A line that never reaches a `+++` header (a hand-built diff, an unborn index)
 * lands in the `fallbackFile` section, and a `+` line with no hunk header is
 * still collected — numbered from 1 within its section — so a malformed diff
 * keeps its coverage instead of silently dropping it.
 */
export function parseUnifiedDiffSections(diff: string, fallbackFile: string): DiffFileSection[] {
  const sections: DiffFileSection[] = [];
  const byFile = new Map<string, DiffFileSection>();
  const unlabeled: DiffFileSection = { file: fallbackFile, added: [] };
  let current: DiffFileSection | null = null;
  // The new-file line number the next body line will occupy; 0 outside a hunk.
  let nextLine = 0;
  // New-file lines still expected in the current hunk. 0 = no active hunk —
  // the only state in which a `+++` line is honored as a file header (see the
  // Batch O+ note above).
  let newSideLeft = 0;
  const sectionFor = (file: string): DiffFileSection => {
    let section = byFile.get(file);
    if (!section) {
      section = { file, added: [] };
      byFile.set(file, section);
      sections.push(section);
    }
    return section;
  };
  for (const raw of diff.split("\n")) {
    if (newSideLeft === 0 && raw.startsWith("+++ ")) {
      const file = diffHeaderPath(raw.slice(4));
      current = file.length > 0 ? sectionFor(file) : null;
      nextLine = 0;
      continue;
    }
    const hunk = HUNK_HEADER_RE.exec(raw);
    if (hunk !== null) {
      nextLine = Number(hunk[1]);
      newSideLeft = hunk[2] !== undefined ? Number(hunk[2]) : 1;
      continue;
    }
    if (raw.startsWith("+")) {
      const target = current ?? unlabeled;
      // Some producers emit a header and the added lines with NO hunk header
      // (a hand-built diff). Number those from 1 rather than dropping them: an
      // unscanned line is worse than an approximate position, and for the
      // new-file shape the added stream 1..n IS the file's own numbering.
      if (nextLine === 0) nextLine = target.added.length + 1;
      target.added.push({ line: nextLine, text: raw.slice(1) });
      nextLine += 1;
      if (newSideLeft > 0) newSideLeft -= 1;
      continue;
    }
    if (nextLine === 0) continue;
    if (!raw.startsWith("-") && !raw.startsWith("\\")) {
      nextLine += 1; // a context line advances the new-file numbering
      if (newSideLeft > 0) newSideLeft -= 1; // and consumes one new-file slot
    }
  }
  if (unlabeled.added.length > 0) sections.push(unlabeled);
  return sections.filter((section) => section.added.length > 0);
}

/**
 * Scan a unified diff FILE BY FILE: every file's added lines are judged under
 * its real path and reported at its real new-file line number. The CLI gate
 * and the guardian interceptor both feed the same scanner, so this layer only
 * supplies identity — the rules and their path policy stay in one place.
 */
export function scanUnifiedDiffForSlop(
  diff: string,
  scope: GuardianScope,
  customRules: readonly CustomGuardianRule[] = [],
  fallbackFile = "(unlabeled diff)"
): GuardianViolation[] {
  const violations: GuardianViolation[] = [];
  for (const section of parseUnifiedDiffSections(diff, fallbackFile)) {
    const text = section.added.map((line) => line.text).join("\n");
    for (const violation of scanTextForSlop(section.file, text, scope, customRules)) {
      // The scanner reports a position in the added-lines text it was handed,
      // so map that back to the file's own numbering before reporting.
      const source = section.added[violation.line - 1];
      violations.push(source ? { ...violation, line: source.line } : violation);
    }
  }
  return violations;
}
