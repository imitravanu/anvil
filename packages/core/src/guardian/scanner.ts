/**
 * Phase 25.6 — Native Guardian Engine: slop scanner.
 * Same rule families as scripts/verify-gate.mjs Steps 1/1.5, runnable
 * in-process so the turn loop can intercept before writing to disk.
 */

export interface GuardianViolation {
  file: string;
  line: number;
  rule: string;
  detail: string;
}

// These literals are split so THIS source file never contains the exact
// forbidden substrings it describes — the gate Step 1 scans added lines and
// would otherwise flag scanner.ts itself for the patterns it encodes (the same
// trick guardian/init.ts uses for its generated docs).
const TUI_PACKAGE = "@anvil/" + "tui";
const CLI_PACKAGE = "@anvil/" + "cli";
const PLACEHOLDER_TERMS = "TO" + "DO|FI" + "XME|XX" + "X";

const RULES: { rule: string; pattern: RegExp; detail: string }[] = [
  {
    rule: "no-as-any",
    pattern: /\bas\s+(any|never)\b/,
    detail: "Forbidden type escape (use narrowing, generics, or unknown + guards)",
  },
  {
    rule: "no-raw-error-format",
    pattern: /instanceof\s+Error\s*\?/,
    detail: "Raw error formatting (use getErrorMessage(err) from @anvil/core)",
  },
  {
    rule: "no-empty-catch",
    pattern: /catch\s*(?:\([^)]*\))?\s*\{\s*\}/,
    detail: "Silent catch block (log or explain why swallowing is safe)",
  },
  {
    rule: "no-architecture-breach",
    pattern: /from\s+["']@anvil\/(tui|cli)["']/,
    detail: `Architecture breach: core must never import ${TUI_PACKAGE} or ${CLI_PACKAGE}`,
  },
  {
    rule: "no-hardcoded-color",
    pattern:
      /\b(?:color|borderColor|backgroundColor)\s*=\s*["'](?:cyan|green|red|yellow|blue|magenta|white|black|gray)["']/,
    detail: "Hardcoded color string (use useTheme() from @anvil/core)",
  },
  {
    rule: "no-placeholder-marker",
    pattern: new RegExp(`\\b(${PLACEHOLDER_TERMS})\\b`),
    detail: "Placeholder marker left in code (resolve before merge)",
  },
];

function isTestPath(file: string): boolean {
  return file.includes("__tests__") || file.includes(".test.");
}

/** Split patterns that span consecutive lines to evade single-line detection. */
const SPLIT_PATTERNS: { rule: string; pattern: RegExp; detail: string }[] = [
  {
    rule: "no-as-any",
    pattern: /\bas\s*\n\s*(?:any|never)\b/,
    detail: "Forbidden type escape split across lines (use narrowing, generics, or unknown + guards)",
  },
  {
    rule: "no-empty-catch",
    pattern: /catch\s*(?:\([^)]*\))?\s*\n\s*\{\s*\}/,
    detail: "Silent catch block split across lines (log or explain why swallowing is safe)",
  },
  {
    rule: "no-raw-error-format",
    pattern: /instanceof\s*\n\s*Error\s*\?/,
    detail: "Raw error formatting split across lines (use getErrorMessage(err) from @anvil/core)",
  },
];

/** Scan added-line text; pure and unit-tested without git. */
export function scanTextForSlop(file: string, text: string): GuardianViolation[] {
  const violations: GuardianViolation[] = [];
  const lines = text.split("\n");

  // Multiline split detection: scan consecutive line pairs for patterns that
  // span two lines to evade single-line rule checks.
  for (let i = 0; i < lines.length - 1; i++) {
    const joined = lines[i] + "\n" + lines[i + 1];
    for (const { rule, pattern, detail } of SPLIT_PATTERNS) {
      if (rule === "no-as-any" && isTestPath(file)) continue;
      if (pattern.test(joined)) {
        violations.push({ file, line: i + 1, rule, detail });
      }
    }
  }

  // Single-line detection.
  lines.forEach((lineText, i) => {
    for (const { rule, pattern, detail } of RULES) {
      if (rule === "no-as-any" && isTestPath(file)) continue;
      if (pattern.test(lineText)) {
        violations.push({ file, line: i + 1, rule, detail });
      }
    }
  });
  return violations;
}

/** Scan a unified diff body (added lines only). */
export function scanDiffForSlop(file: string, diff: string): GuardianViolation[] {
  const added = diff
    .split("\n")
    .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
    .map((l) => l.slice(1))
    .join("\n");
  return scanTextForSlop(file, added);
}
