import { Box, Text, useStdout } from "ink";
import { useTheme } from "../theme/theme.js";
import { collapsePlan } from "../util/format.js";

/**
 * Phase 8.5 (U1): the agent's current plan, always visible above the input,
 * collapsed to at most two width-fitting lines. Hidden entirely when no plan
 * is set. Updates live via plan_updated events.
 */
export function PlanLine({ plan }: { plan: string }) {
  const theme = useTheme();
  const { stdout } = useStdout();
  const width = stdout?.columns ?? 80;
  const { lines, hidden } = collapsePlan(plan, width);
  if (lines.length === 0) return null;
  return (
    <Box flexDirection="column" paddingX={theme.spacing.panelPaddingX}>
      {lines.map((line, i) => (
        <Text key={i}>
          {i === 0 ? (
            <Text color={theme.colors.accent} bold>plan ▸ </Text>
          ) : (
            <Text>        </Text>
          )}
          <Text dimColor>{line}</Text>
          {i === lines.length - 1 && hidden > 0 ? (
            <Text dimColor> … +{hidden} more line{hidden === 1 ? "" : "s"}</Text>
          ) : null}
        </Text>
      ))}
    </Box>
  );
}