import { Box, Text, useStdout } from "ink";
import { useTheme } from "../theme/theme.js";
import { collapsePlan, curtail } from "../util/format.js";
import { useSpinnerFrame } from "../util/useSpinner.js";
import type { DisplayGoal } from "../hooks/useAgentController.js";

export interface MissionDeckProps {
  goal?: DisplayGoal | null;
  plan?: string | null;
  isBusy?: boolean;
}

export function MissionDeck({ goal, plan, isBusy = false }: MissionDeckProps) {
  const theme = useTheme();
  const { stdout } = useStdout();
  const width = Math.max(20, (stdout?.columns ?? 80) - 2);
  const spinner = useSpinnerFrame(isBusy);

  // If full autonomous mission goal is active, render the rich Mission Deck
  if (goal && goal.milestones.length > 0) {
    const completedCount = goal.milestones.filter((m) => m.status === "completed").length;
    const totalCount = goal.milestones.length;

    return (
      <Box
        flexDirection="column"
        flexShrink={0}
        borderStyle="round"
        borderColor={theme.colors.accent}
        paddingX={1}
        marginX={1}
      >
        <Box justifyContent="space-between">
          <Box gap={1}>
            <Text bold color={theme.colors.accent}>
              🎯 MISSION:
            </Text>
            <Text bold>{curtail(goal.title, Math.max(12, width - 35))}</Text>
          </Box>
          <Text dimColor>
            [{completedCount}/{totalCount}] · Turn {goal.currentTurn}/{goal.maxTurns}
          </Text>
        </Box>

        {goal.milestones.map((m) => {
          const isDone = m.status === "completed";
          const isRunning = m.status === "in_progress";
          const isFailed = m.status === "failed";

          const glyph = isDone ? "✓" : isRunning ? spinner : isFailed ? "✗" : "○";
          const glyphColor = isDone
            ? theme.colors.toolDone
            : isRunning
              ? theme.colors.toolRunning
              : isFailed
                ? theme.colors.toolError
                : theme.colors.dim;

          return (
            <Box key={m.id} paddingLeft={1} gap={1}>
              <Text color={glyphColor}>{glyph}</Text>
              <Text bold={isRunning} dimColor={!isRunning && !isDone}>
                {m.id}. {curtail(m.title, Math.max(10, width - 25))}
              </Text>
              {m.detail && isRunning && (
                <Text color={theme.colors.accent} dimColor>
                  ({curtail(m.detail, 30)})
                </Text>
              )}
            </Box>
          );
        })}
      </Box>
    );
  }

  // Fallback: If single-line plan is set, render the standard collapsed plan
  if (plan) {
    const { lines, hidden } = collapsePlan(plan, width);
    if (lines.length === 0) return null;
    return (
      <Box flexDirection="column" flexShrink={0} paddingX={theme.spacing.panelPaddingX}>
        {lines.map((line, i) => (
          <Text key={i}>
            {i === 0 ? (
              <Text color={theme.colors.accent} bold>
                plan ▸{" "}
              </Text>
            ) : (
              <Text>        </Text>
            )}
            <Text dimColor>{line}</Text>
            {i === lines.length - 1 && hidden > 0 ? (
              <Text dimColor>
                {" "}
                … +{hidden} more line{hidden === 1 ? "" : "s"}
              </Text>
            ) : null}
          </Text>
        ))}
      </Box>
    );
  }

  return null;
}
