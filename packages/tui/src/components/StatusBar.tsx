import { Box, Text, useStdout } from "ink";
import type { UsageTotals } from "../hooks/useAgentController.js";
import { useTheme } from "../theme/theme.js";
import { breakpointForWidth } from "../hooks/useTerminalSize.js";
import { curtail, displayModelLabel, displayWidth, formatPricingTag, modelInfo } from "../util/format.js";
import { STATUS_MODEL_MAX, STATUS_MODEL_MIN } from "../util/displayLimits.js";
import { brailleSparkline } from "../util/braille.js";
import { useSpinnerFrame } from "../util/useSpinner.js";
import { ContextGauge, gaugeDisplayText } from "./ContextGauge.js";

export interface StatusBarProps {
  minimal?: boolean;
  selectionNotice?: string | null;
  contextEstimate?: { tokens: number; limit: number };
  waiting?: boolean;
  model: string;
  isBusy: boolean;
  /** Provider the session runs on — qualifies ambiguous model ids (AUDIT-02). */
  providerId?: string;
  usage: UsageTotals;
  checkpointCount?: number;
  testStatus?: "green" | "failed" | "running" | null;
  /** Per-turn input-token samples for the wide-only growth sparkline. */
  tokenHistory?: readonly number[];
}

const fmt = (n: number): string => n.toLocaleString("en-US");

export function StatusBar({
  model,
  isBusy,
  providerId,
  usage,
  checkpointCount,
  testStatus,
  tokenHistory = [],
  minimal = false,
  contextEstimate,
  waiting = false,
  selectionNotice,
}: StatusBarProps) {
  const theme = useTheme();
  const { stdout } = useStdout();
  const width = stdout?.columns ?? 80;
  const busyFrame = useSpinnerFrame(isBusy);
  // Provider-qualified (AUDIT-02): a free model on one provider must not render
  // its paid sibling's pricing/context window here.
  const info = modelInfo(model, providerId);
  if (minimal) {
    const label = waiting ? "Waiting for approval" : isBusy ? "Working · Esc cancel" : "Ready";
    const context = contextEstimate && width >= 80 ? ` · context ~${Math.round(100 * contextEstimate.tokens / contextEstimate.limit)}%` : "";
    if (width < 80) return <Text color={theme.colors.textSecondary} wrap="truncate-end">{waiting ? "Waiting for approval" : selectionNotice ?? (isBusy ? "Working · Enter queue · Esc cancel" : "Enter send · / commands · ? help")}</Text>;
    return <Box flexShrink={0} justifyContent="space-between" paddingX={1}>
      <Text color={theme.colors.textSecondary} wrap="truncate-end">{selectionNotice ?? `${isBusy ? "Enter queue" : "Enter send"} · Ctrl+J newline · / commands`}</Text>
      <Text color={waiting ? theme.colors.warning : theme.colors.textSecondary} wrap="truncate-end">{label}{context}</Text>
    </Box>;
  }

  const modelLabel = `${displayModelLabel(model, providerId)}${formatPricingTag(info?.isFree)}`;
  const state = isBusy ? (
    <>
      <Text color={theme.colors.accent}>{busyFrame}</Text> busy
    </>
  ) : (
    "○ idle"
  );
  const statePlain = isBusy ? `${busyFrame} busy` : "○ idle";
  // Phase 38.2: show the two facts the flat pair used to hide — how much of
  // `out` was reasoning, and how much of `in` came from the prompt cache
  // (already inside inputTokens, so it is a share, not an addition).
  const thinkingShare =
    usage.reasoningTokens && usage.reasoningTokens > 0 && usage.outputTokens > 0
      ? Math.round((usage.reasoningTokens / usage.outputTokens) * 100)
      : null;
  const tokens =
    `tokens ${fmt(usage.inputTokens)} in · ${fmt(usage.outputTokens)} out` +
    (thinkingShare !== null ? ` (${thinkingShare}% thinking)` : "") +
    (usage.cachedInputTokens && usage.cachedInputTokens > 0
      ? ` · ${Math.round((usage.cachedInputTokens / Math.max(usage.inputTokens, 1)) * 100)}% cached`
      : "");
  // Phase 41: `?` now opens the searchable key/command reference, so advertise
  // it (and keep the /help command name for people who reach for a slash).
  const hints = isBusy ? "esc cancel · ctrl+c cancel" : "? help · ctrl+c exit";

  // DW-4.2 context gauge (adaptive component) + DW-4.3 token-growth
  // sparkline on wide terminals. Both measured verbatim for the budget.
  const gaugeText = gaugeDisplayText(usage.inputTokens, info?.contextWindow, width, theme.chrome.meterStyle, theme.responsive);
  const gaugePlain = gaugeText ? ` │ ${gaugeText}` : "";
  // Theme-driven (2026-10-10): the sparkline rides the normalWidth tier, not a
  // hardcoded 120 — custom themes move it with the rest of the chrome.
  const spark = width >= theme.responsive.normalWidth && tokenHistory.length >= 2 ? brailleSparkline(tokenHistory) : "";
  // Rendered only beside the gauge (see `left`), so the width budget must
  // count it the same way — an unknown model hides the gauge, and charging
  // the bar for an invisible sparkline curtails the tokens/hints instead.
  const sparkPlain = spark && gaugeText ? ` ${spark}` : "";

  const checkpointPlain = checkpointCount && checkpointCount > 0 ? ` │ ⎌ ${checkpointCount}` : "";
  const testPlain = testStatus ? ` │ 🧪 ${testStatus}` : "";

  // Width accounting in terminal CELLS (emoji are 2); reserve covers the DW-2.4
  // frame border (2) + inner padding + the outer frame's two border columns.
  const avail = Math.max(20, width - 2 * theme.spacing.panelPaddingX - 4);
  const fixedPlain = `${curtail(modelLabel, STATUS_MODEL_MAX)} │ ${statePlain}${checkpointPlain}${testPlain}${gaugePlain}${sparkPlain} │ `;
  const tokensShown = (() => {
    const room = avail - displayWidth(fixedPlain);
    if (displayWidth(tokens) <= room) return tokens;
    return curtail(tokens, Math.max(0, room - 1));
  })();
  const budget = avail - displayWidth(fixedPlain + tokensShown);

  const testColor =
    testStatus === "green"
      ? theme.colors.success
      : testStatus === "failed"
        ? theme.colors.error
        : theme.colors.warning;

  // DW-2.4 segmented frame. Compact terminals (<80) stack two lines so the
  // gauge and hints survive instead of being curtailed away.
  const compact = breakpointForWidth(width, theme.responsive) === "compact";
  // Readable segments ride textSecondary; only the `│` separators and the
  // sparkline stay dim (decorative — phase 28.8). Mixing them in one Text and
  // relying on `dimColor` made the labels and separators indistinguishable.
  const sep = <Text color={theme.colors.dim}> │ </Text>;
  const left = (
    <Text color={theme.colors.textSecondary}>
      {curtail(modelLabel, STATUS_MODEL_MAX)}
      {sep}
      {state}
      {checkpointCount !== undefined && checkpointCount > 0 && (
        <Text>
          {sep}⎌ {checkpointCount}
        </Text>
      )}
      {testStatus && (
        <Text>
          {sep}
          <Text color={testColor}>🧪 {testStatus}</Text>
        </Text>
      )}
      {gaugeText && (
        <Text>
          {sep}
          <ContextGauge inputTokens={usage.inputTokens} contextWindow={info?.contextWindow} width={width} />
          {sparkPlain !== "" && <Text color={theme.colors.textSecondary}>{sparkPlain}</Text>}
        </Text>
      )}{" "}
      <Text color={theme.colors.dim}>│</Text> {tokensShown}
    </Text>
  );

  return (
    // flexShrink 0 is load-bearing: when an unsrinkable transcript message
    // overflows the frame, Yoga distributes shrink across every shrinkable
    // child and this bar loses its rows entirely (the status bar
    // "disappears" on long replies).
    <Box
      flexShrink={0}
      flexDirection="column"
      borderStyle={theme.borders.panel}
      borderColor={theme.colors.border}
      paddingX={theme.spacing.panelPaddingX}
    >
      {compact ? (
        <>
          <Box justifyContent="space-between" flexShrink={0}>
            <Text color={theme.colors.textSecondary}>
              {curtail(modelLabel, STATUS_MODEL_MIN)} <Text color={theme.colors.dim}>│</Text> {state}
            </Text>
            {gaugeText && (
              <ContextGauge inputTokens={usage.inputTokens} contextWindow={info?.contextWindow} width={width} />
            )}
          </Box>
          <Box justifyContent="space-between" flexShrink={0}>
            <Text color={theme.colors.textSecondary}>{tokensShown}</Text>
            <Text color={theme.colors.textSecondary}>{hints}</Text>
          </Box>
        </>
      ) : (
        <Box justifyContent="space-between" flexShrink={0}>
          {left}
          {budget >= hints.length ? <Text color={theme.colors.textSecondary}>{hints}</Text> : null}
        </Box>
      )}
    </Box>
  );
}
