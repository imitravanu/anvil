import { Box, Text, useStdout } from "ink";
import { useTheme } from "../theme/theme.js";
import { inkBorderStyle } from "../util/chrome.js";
import { collapsePlan, curtail } from "../util/format.js";
import { MISSION_DETAIL_MAX } from "../util/displayLimits.js";
import { useSpinnerFrame } from "../util/useSpinner.js";
import type { DisplayGoal } from "../hooks/useAgentController.js";
import { sanitizeTerminalText } from "../util/sanitize.js";

export interface MissionDeckProps {
  compact?: boolean;
  goal?: DisplayGoal | null;
  plan?: string | null;
  isBusy?: boolean;
}

export function MissionDeck({ goal, plan, isBusy = false, compact = false }: MissionDeckProps) {
  const theme = useTheme();
  const { stdout } = useStdout();
  const width = Math.max(20, (stdout?.columns ?? 80) - 2);
  // DW-3.1 blocks = goal milestone progress (filling up).
  const spinner = useSpinnerFrame(isBusy, "blocks");
  if (compact) {
    const current = goal?.milestones.find(milestone => milestone.status === "in_progress");
    const text = current?.title ?? goal?.title ?? plan?.split("\n").find(line => line.trim());
    if (!text) return null;
    const count = goal ? `${goal.milestones.filter(m => m.status === "completed").length}/${goal.milestones.length} · ` : "";
    return <Text color={theme.colors.textSecondary} wrap="truncate-end">{isBusy ? spinner : "·"} Plan {count}{curtail(sanitizeTerminalText(text).replace(/\n/g, " "), Math.max(8, width - 30))} · Ctrl+P details</Text>;
  }

  // If full autonomous mission goal is active, render the rich Mission Deck
  if (goal && goal.milestones.length > 0) {
    const completedCount = goal.milestones.filter((m) => m.status === "completed").length;
    const totalCount = goal.milestones.length;
    // The deck is flexShrink={0} chrome — with 10+ milestones (plus overlays
    // borrowing nothing from it) it can overflow the frame. Show a window
    // around the active milestone; the header already carries the counts.
    const MAX_DECK_ROWS = 5;
    const activeIdx = goal.milestones.findIndex((m) => m.status === "in_progress");
    const deckStart =
      goal.milestones.length > MAX_DECK_ROWS
        ? Math.max(0, Math.min(activeIdx - 1, goal.milestones.length - MAX_DECK_ROWS))
        : 0;
    const deckRows = goal.milestones.slice(deckStart, deckStart + MAX_DECK_ROWS);
    const hiddenBefore = deckStart;
    const hiddenAfter = goal.milestones.length - deckStart - deckRows.length;

    return (
      <Box
        flexDirection="column"
        flexShrink={0}
        borderStyle={inkBorderStyle(theme.borders.card)}
        borderColor={theme.colors.accent}
        paddingX={1}
        marginX={1}
        overflow="hidden"
      >
        <Box justifyContent="space-between">
          <Box gap={1}>
            <Text bold color={theme.colors.accent}>
              🎯 MISSION:
            </Text>
            <Text bold>{curtail(goal.title, Math.max(12, width - 35))}</Text>
          </Box>
          <Text color={theme.colors.textSecondary}>
            [{completedCount}/{totalCount}] · Turn {goal.currentTurn}/{goal.maxTurns}
          </Text>
        </Box>

        {hiddenBefore > 0 && (
          <Text color={theme.colors.textSecondary}>  … {hiddenBefore} earlier milestone{hiddenBefore === 1 ? "" : "s"}</Text>
        )}
        {deckRows.map((m) => {
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
                : theme.colors.textSecondary;

          return (
            <Box key={m.id} paddingLeft={1} gap={1}>
              <Text color={glyphColor}>{glyph}</Text>
              <Text bold={isRunning} color={!isRunning && !isDone ? theme.colors.textSecondary : undefined}>
                {m.id}. {curtail(m.title, Math.max(10, width - 25))}
              </Text>
              {m.detail && isRunning && (
                <Text color={theme.colors.textSecondary}>
                  ({curtail(m.detail, MISSION_DETAIL_MAX)})
                </Text>
              )}
            </Box>
          );
        })}
        {hiddenAfter > 0 && (
          <Text color={theme.colors.textSecondary}>  … {hiddenAfter} more milestone{hiddenAfter === 1 ? "" : "s"}</Text>
        )}
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
            <Text color={theme.colors.textSecondary}>{line}</Text>
            {i === lines.length - 1 && hidden > 0 ? (
              <Text color={theme.colors.textSecondary}>
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
