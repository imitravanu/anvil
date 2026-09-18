import { Box, Text, useStdout } from "ink";
import { MODEL_REGISTRY } from "@anvil/core";
import type { UsageTotals } from "../hooks/useAgentController.js";
import { useTheme } from "../theme/theme.js";
import { breakpointForWidth } from "../hooks/useTerminalSize.js";
import { curtail, displayModelLabel, displayWidth, formatPricingTag } from "../util/format.js";
import { brailleSparkline } from "../util/braille.js";
import { useSpinnerFrame } from "../util/useSpinner.js";
import { ContextGauge, gaugeDisplayText } from "./ContextGauge.js";

export interface StatusBarProps {
  model: string;
  isBusy: boolean;
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
  usage,
  checkpointCount,
  testStatus,
  tokenHistory = [],
}: StatusBarProps) {
  const theme = useTheme();
  const { stdout } = useStdout();
  const width = stdout?.columns ?? 80;
  const busyFrame = useSpinnerFrame(isBusy);
  const info = MODEL_REGISTRY.find((m) => m.id === model);

  const modelLabel = `${displayModelLabel(model)}${formatPricingTag(info?.isFree)}`;
  const state = isBusy ? (
    <>
      <Text color={theme.colors.accent}>{busyFrame}</Text> busy
    </>
  ) : (
    "○ idle"
  );
  const statePlain = isBusy ? `${busyFrame} busy` : "○ idle";
  const tokens = `tokens ${fmt(usage.inputTokens)} in · ${fmt(usage.outputTokens)} out`;
  const hints = isBusy ? "esc cancel · ctrl+c cancel" : "ctrl+c exit · /help";

  // DW-4.2 context gauge (adaptive component) + DW-4.3 token-growth
  // sparkline on wide terminals. Both measured verbatim for the budget.
  const gaugeText = gaugeDisplayText(usage.inputTokens, info?.contextWindow, width);
  const gaugePlain = gaugeText ? ` │ ${gaugeText}` : "";
  const spark = width >= 120 && tokenHistory.length >= 2 ? brailleSparkline(tokenHistory) : "";
  const sparkPlain = spark ? ` ${spark}` : "";

  const checkpointPlain = checkpointCount && checkpointCount > 0 ? ` │ ⎌ ${checkpointCount}` : "";
  const testPlain = testStatus ? ` │ 🧪 ${testStatus}` : "";

  // Width accounting in terminal CELLS (emoji are 2); reserve covers the DW-2.4
  // frame border (2) + inner padding + the outer frame's two border columns.
  const avail = Math.max(20, width - 2 * theme.spacing.panelPaddingX - 4);
  const fixedPlain = `${curtail(modelLabel, 40)} │ ${statePlain}${checkpointPlain}${testPlain}${gaugePlain}${sparkPlain} │ `;
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
  const left = (
    <Text dimColor>
      {curtail(modelLabel, 40)} │ {state}
      {checkpointCount !== undefined && checkpointCount > 0 && (
        <Text dimColor>
          {" │ "}⎌ {checkpointCount}
        </Text>
      )}
      {testStatus && (
        <Text>
          {" │ "}
          <Text color={testColor}>🧪 {testStatus}</Text>
        </Text>
      )}
      {gaugeText && (
        <Text>
          {" │ "}
          <ContextGauge inputTokens={usage.inputTokens} contextWindow={info?.contextWindow} width={width} />
          {spark && <Text dimColor>{sparkPlain}</Text>}
        </Text>
      )}{" "}
      │ {tokensShown}
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
            <Text dimColor>
              {curtail(modelLabel, 24)} │ {state}
            </Text>
            {gaugeText && (
              <ContextGauge inputTokens={usage.inputTokens} contextWindow={info?.contextWindow} width={width} />
            )}
          </Box>
          <Box justifyContent="space-between" flexShrink={0}>
            <Text dimColor>{tokensShown}</Text>
            <Text dimColor>{hints}</Text>
          </Box>
        </>
      ) : (
        <Box justifyContent="space-between" flexShrink={0}>
          {left}
          {budget >= hints.length ? <Text dimColor>{hints}</Text> : null}
        </Box>
      )}
    </Box>
  );
}
