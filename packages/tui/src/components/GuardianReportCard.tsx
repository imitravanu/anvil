import { Box, Text } from "ink";
import type { GuardianRuleFamily } from "@anvil/core";
import type { DisplayGuardianReport } from "../hooks/useAgentController.js";
import { useTheme } from "../theme/theme.js";
import { curtail } from "../util/format.js";
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

export function GuardianReportCard({ report }: { report: DisplayGuardianReport }) {
  const theme = useTheme();
  const familyLabel = (family: string): string =>
    isFamily(family) ? FAMILY_LABELS[family] : family;
  const blockedLabel = `${report.blocked} blocked`;
  const fixedLabel = report.fixed > 0 ? ` · ${report.fixed} auto-fixed` : "";
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.colors.border} paddingX={1} marginY={1}>
      <Box gap={1}>
        <Text color={theme.colors.error}>⚠ </Text>
        <Text bold color={theme.colors.accent}>Guardian</Text>
        <Text color={theme.colors.dim}>— guarded before execution</Text>
      </Box>
      <Box paddingLeft={2}>
        <Text color={report.blocked > 0 ? theme.colors.error : theme.colors.toolDone}>
          {blockedLabel}
          {fixedLabel}
        </Text>
      </Box>
      {report.violations.slice(0, 8).map((v, i) => (
        <Box key={`${v.file}:${v.line}:${i}`} paddingLeft={2}>
          <Text color={theme.colors.userText}>
            {"• "}
            {sanitizeTerminalText(v.file)}:{v.line}
          </Text>
          <Text color={theme.colors.dim}> [{familyLabel(v.family)}] </Text>
          <Text color={theme.colors.userText}>{curtail(sanitizeTerminalText(v.detail), 80)}</Text>
        </Box>
      ))}
      {report.violations.length > 8 && (
        <Box paddingLeft={2}>
          <Text color={theme.colors.dim}>… {report.violations.length - 8} more</Text>
        </Box>
      )}
      <Box paddingLeft={2}>
        <Text color={theme.colors.dim}>Fix the violations and retry — do not re-emit unchanged calls.</Text>
      </Box>
    </Box>
  );
}
