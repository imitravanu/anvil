import { Box, Text, useStdout } from "ink";
import { MODEL_REGISTRY } from "@anvil/core";
import type { UsageTotals } from "../hooks/useAgentController.js";
import { useTheme } from "../theme/theme.js";
import { contextGauge, curtail, displayModelLabel, displayWidth, formatPricingTag } from "../util/format.js";
import { useSpinnerFrame } from "../util/useSpinner.js";

export interface StatusBarProps {
  model: string;
  isBusy: boolean;
  usage: UsageTotals;
  checkpointCount?: number;
  testStatus?: "green" | "failed" | "running" | null;
}

const fmt = (n: number): string => n.toLocaleString("en-US");

export function StatusBar({
  model,
  isBusy,
  usage,
  checkpointCount,
  testStatus,
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

  // Context gauge: real per-turn input tokens vs the model's window.
  const gauge = contextGauge(usage.inputTokens, info?.contextWindow);
  const gaugePlain = gauge ? ` │ ${gauge.text}` : "";
  const gaugeWarn = gauge !== null && gauge.fraction >= 0.75;

  const checkpointPlain = checkpointCount && checkpointCount > 0 ? ` │ ⎌ ${checkpointCount}` : "";
  const testPlain = testStatus ? ` │ 🧪 ${testStatus}` : "";

  // Width accounting in terminal CELLS (emoji are 2), and the reserve covers
  // the outer frame's two border columns — a left segment measured in code
  // points alone wrapped the tokens onto a second row and grew this zone.
  const avail = Math.max(20, width - 2 * theme.spacing.panelPaddingX - 2);
  const fixedPlain = `${curtail(modelLabel, 40)} │ ${statePlain}${checkpointPlain}${testPlain}${gaugePlain} │ `;
  const tokensShown = (() => {
    const room = avail - displayWidth(fixedPlain);
    if (displayWidth(tokens) <= room) return tokens;
    return curtail(tokens, Math.max(0, room - 1));
  })();
  const budget = avail - displayWidth(fixedPlain + tokensShown);

  return (
    // flexShrink 0 is load-bearing: when an unsrinkable transcript message
    // overflows the frame, Yoga distributes shrink across every shrinkable
    // child and this single-row bar loses its row entirely (the status bar
    // "disappears" on long replies).
    <Box flexShrink={0} paddingX={theme.spacing.panelPaddingX} justifyContent="space-between">
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
            <Text
              color={
                testStatus === "green"
                  ? theme.colors.toolDone
                  : testStatus === "failed"
                    ? theme.colors.toolError
                    : theme.colors.toolRunning
              }
            >
              🧪 {testStatus}
            </Text>
          </Text>
        )}
        {gauge && (
          <Text color={gaugeWarn ? theme.colors.toolRunning : undefined} dimColor={!gaugeWarn}>
            {" │ "}
            {gauge.text}
          </Text>
        )}{" "}
        │ {tokensShown}
      </Text>
      {budget >= hints.length ? <Text dimColor>{hints}</Text> : null}
    </Box>
  );
}
