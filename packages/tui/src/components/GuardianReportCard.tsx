import { Box, Text } from "ink";
import type { GuardianRuleFamily } from "@imitravanu/anvil-core";
import type { DisplayGuardianReport } from "../hooks/useAgentController.js";
import { useTheme } from "../theme/theme.js";
import { inkBorderStyle } from "../util/chrome.js";
import { curtail } from "../util/format.js";
import { GUARDIAN_DETAIL_MAX, GUARDIAN_VIOLATIONS_SHOWN } from "../util/displayLimits.js";
import { sanitizeTerminalText } from "../util/sanitize.js";

/**
 * Human labels for the coarse rule families (Phase 26.1 report).
 *
 * Typed as a TOTAL map over core's union rather than `Record<string, string>`:
 * adding a family in `guardian/scanner.ts` now fails the TUI typecheck here
 * instead of silently printing the raw family id in the card. The display DTO
 * keeps `family: string` on purpose, so the lookup below still narrows at
 * runtime for a report from an older/newer core.
 */
const FAMILY_LABELS: Record<GuardianRuleFamily, string> = {
  "placeholder": "placeholder",
  "raw-error": "raw error",
  "style": "style",
  "secret": "secret",
  "architecture": "architecture",
  "type-escape": "type escape",
  "rule": "project rule",
};

const isFamily = (value: string): value is GuardianRuleFamily => value in FAMILY_LABELS;

/** A string field of an untrusted payload, or `fallback` when it is not a string. */
const stringField = (value: unknown, fallback: string): string =>
  typeof value === "string" ? value : fallback;

export function GuardianReportCard({ report }: { report: DisplayGuardianReport }) {
  const theme = useTheme();
  // Malformed data must degrade THAT ONE row, never the transcript (2026-10-14
  // fuzz). A non-object drops out; a field of the wrong TYPE is coerced, because
  // every field below reaches a string-only helper — one missing `detail` threw
  // out of `sanitizeTerminalText`, through the transcript boundary, and blanked
  // the whole session view.
  const violations = (Array.isArray(report.violations) ? report.violations : [])
    .filter((v): v is DisplayGuardianReport["violations"][number] => typeof v === "object" && v !== null)
    .map((v, i) => {
      const fields = v as Record<string, unknown>;
      return {
        key: `${stringField(fields.file, "?")}:${String(fields.line ?? "?")}:${i}`,
        file: stringField(fields.file, "(unknown file)"),
        line: typeof fields.line === "number" ? fields.line : stringField(fields.line, "?"),
        family: stringField(fields.family, "rule"),
        detail: stringField(fields.detail, "(no detail)"),
      };
    });
  const familyLabel = (family: string): string =>
    isFamily(family) ? FAMILY_LABELS[family] : family;
  const blocked = typeof report.blocked === "number" ? report.blocked : 0;
  const fixed = typeof report.fixed === "number" ? report.fixed : 0;
  const blockedLabel = `${blocked} blocked`;
  const fixedLabel = fixed > 0 ? ` · ${fixed} auto-fixed` : "";
  return (
    <Box flexDirection="column" borderStyle={inkBorderStyle(theme.borders.card)} borderColor={theme.colors.border} paddingX={1} marginY={1}>
      <Box gap={1}>
        <Text color={theme.colors.error}>⚠ </Text>
        <Text bold color={theme.colors.accent}>Guardian</Text>
        <Text color={theme.colors.textSecondary}>— guarded before execution</Text>
      </Box>
      <Box paddingLeft={2}>
        <Text color={blocked > 0 ? theme.colors.error : theme.colors.toolDone}>
          {blockedLabel}
          {fixedLabel}
        </Text>
      </Box>
      {violations.slice(0, GUARDIAN_VIOLATIONS_SHOWN).map((v) => (
        <Box key={v.key} paddingLeft={2}>
          <Text color={theme.colors.userText}>
            {"• "}
            {sanitizeTerminalText(v.file)}:{v.line}
          </Text>
          <Text color={theme.colors.textSecondary}> [{familyLabel(v.family)}] </Text>
          <Text color={theme.colors.userText}>{curtail(sanitizeTerminalText(v.detail), GUARDIAN_DETAIL_MAX)}</Text>
        </Box>
      ))}
      {violations.length > GUARDIAN_VIOLATIONS_SHOWN && (
        <Box paddingLeft={2}>
          <Text color={theme.colors.textSecondary}>… {violations.length - GUARDIAN_VIOLATIONS_SHOWN} more</Text>
        </Box>
      )}
      <Box paddingLeft={2}>
        <Text color={theme.colors.textSecondary}>Fix the violations and retry — do not re-emit unchanged calls.</Text>
      </Box>
    </Box>
  );
}
