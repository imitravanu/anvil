import { getErrorMessage } from "../errors.js";
import { GUARDIAN_MAX_AUTO_FIXES } from "../config/constants.js";
import { scanDiffForSlop, type GuardianViolation } from "./scanner.js";

export interface TurnFileChange {
  path: string;
  /** Unified diff of the pending mutation. */
  diff: string;
}

/** An auto-fixed diff, identified by its POSITION in the input change list. */
export interface GuardianFixedFix {
  /** Index into the `changes` array interceptTurn received — same-path edits are distinct changes. */
  index: number;
  path: string;
  diff: string;
}

export interface InterceptResult {
  violations: GuardianViolation[];
  /** Auto-fixed diffs by positional index (empty when nothing was safely fixable). */
  fixed: GuardianFixedFix[];
  /** True when the turn may proceed (no violations or all auto-fixed). */
  allowed: boolean;
}

/** Strip unified-diff markers from a repaired diff, returning the plain text. */
export function guardianFixedText(diff: string): string {
  return diff
    .split("\n")
    .map((line) => (line.startsWith("+") || line.startsWith("-") ? line.slice(1) : line))
    .join("\n");
}

/**
 * Native pre-turn slop interceptor. Scans pending file diffs before the
 * turn writes to disk or presents to the user. Auto-fixes the one safe
 * family (raw error formatting → getErrorMessage); everything else blocks
 * with actionable violations for the model to repair.
 */
export function interceptTurn(changes: TurnFileChange[]): InterceptResult {
  const violations: GuardianViolation[] = [];
  const fixed: GuardianFixedFix[] = [];
  let fixesUsed = 0;

  for (const [idx, change] of changes.entries()) {
    let diff = change.diff;
    try {
      // Repair every safely-fixable raw-error violation, then report what
      // survives. Re-scanning after each successful fix keeps the survivor
      // set honest: a fixed occurrence vanishes from the new text, while an
      // UNFIXABLE one (a different fallback shape, or the fix budget spent)
      // remains and must still block the turn. The previous filter dropped
      // surviving raw-error violations whenever the fix budget was unspent,
      // silently allowing them through.
      let found = scanDiffForSlop(change.path, diff);
      let i = 0;
      while (i < found.length) {
        const v = found[i];
        if (v.rule === "no-raw-error-format" && fixesUsed < GUARDIAN_MAX_AUTO_FIXES) {
          const repaired = autoFixRawErrorFormat(diff);
          if (repaired !== diff) {
            diff = repaired;
            fixesUsed += 1;
            found = scanDiffForSlop(change.path, diff);
            i = 0;
            continue;
          }
        }
        i += 1;
      }
      violations.push(...found);
      if (diff !== change.diff) fixed.push({ index: idx, path: change.path, diff });
    } catch (err: unknown) {
      violations.push({
        file: change.path,
        line: 0,
        rule: "interceptor-error",
        detail: `Guardian scan failed: ${getErrorMessage(err)}`,
      });
    }
  }

  return { violations, fixed, allowed: violations.length === 0 };
}

/** Safe auto-fix: common raw-error ternary → getErrorMessage call. */
export function autoFixRawErrorFormat(diff: string): string {
  return diff
    .replace(/(\w+)\s+instanceof\s+Error\s*\?\s*\1\.message\s*:\s*String\(\1\)/g, "getErrorMessage($1)")
    .replace(/err\s+instanceof\s+Error\s*\?\s*err\.message\s*:\s*String\(err\)/g, "getErrorMessage(err)");
}
