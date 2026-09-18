import { getErrorMessage } from "../errors.js";
import { GUARDIAN_MAX_AUTO_FIXES } from "../config/constants.js";
import { scanDiffForSlop, type GuardianViolation } from "./scanner.js";

export interface TurnFileChange {
  path: string;
  /** Unified diff of the pending mutation. */
  diff: string;
}

export interface InterceptResult {
  violations: GuardianViolation[];
  /** Auto-fixed diffs by path (empty when nothing was safely fixable). */
  fixed: { path: string; diff: string }[];
  /** True when the turn may proceed (no violations or all auto-fixed). */
  allowed: boolean;
}

/**
 * Native pre-turn slop interceptor. Scans pending file diffs before the
 * turn writes to disk or presents to the user. Auto-fixes the one safe
 * family (raw error formatting → getErrorMessage); everything else blocks
 * with actionable violations for the model to repair.
 */
export function interceptTurn(changes: TurnFileChange[]): InterceptResult {
  const violations: GuardianViolation[] = [];
  const fixed: { path: string; diff: string }[] = [];
  let fixesUsed = 0;

  for (const change of changes) {
    let diff = change.diff;
    try {
      const found = scanDiffForSlop(change.path, diff);
      const remaining: GuardianViolation[] = [];
      for (const v of found) {
        if (v.rule === "no-raw-error-format" && fixesUsed < GUARDIAN_MAX_AUTO_FIXES) {
          const repaired = autoFixRawErrorFormat(diff);
          if (repaired !== diff) {
            diff = repaired;
            fixesUsed += 1;
            continue;
          }
        }
        remaining.push(v);
      }
      // Re-scan after fixes: only report what survives.
      const rescan = scanDiffForSlop(change.path, diff).filter((v) => v.rule !== "no-raw-error-format" || fixesUsed >= GUARDIAN_MAX_AUTO_FIXES);
      violations.push(...rescan);
      if (diff !== change.diff) fixed.push({ path: change.path, diff });
      void remaining;
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
