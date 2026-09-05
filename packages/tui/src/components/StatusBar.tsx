import { Box, Text, useStdout } from "ink";
import { MODEL_REGISTRY } from "@anvil/core";
import type { UsageTotals } from "../hooks/useAgentController.js";
import { useTheme } from "../theme/theme.js";
import { contextGauge, curtail, displayModelLabel, formatPricingTag } from "../util/format.js";
import { useSpinnerFrame } from "../util/useSpinner.js";

interface StatusBarProps {
  model: string;
  isBusy: boolean;
  usage: UsageTotals;
}

const fmt = (n: number): string => n.toLocaleString("en-US");

export function StatusBar({ model, isBusy, usage }: StatusBarProps) {
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
  // Context gauge: real per-turn input tokens vs the model's window. Turns
  // amber once compaction territory (75%) is near, so context death stops
  // being invisible until it bites.
  const gauge = contextGauge(usage.inputTokens, info?.contextWindow);
  const gaugePlain = gauge ? ` │ ${gauge.text}` : "";
  const gaugeWarn = gauge !== null && gauge.fraction >= 0.75;

  const leftPlain = `${curtail(modelLabel, 48)} │ ${statePlain}${gaugePlain} │ ${tokens}`;
  const budget = width - leftPlain.length - 6;
  // Hints are hidden (never clipped/wrapped) when they cannot fit.
  return (
    <Box paddingX={theme.spacing.panelPaddingX} justifyContent="space-between">
      <Text dimColor>
        {curtail(modelLabel, 48)} │ {state}
        {gauge && (
          <Text color={gaugeWarn ? theme.colors.toolRunning : undefined} dimColor={!gaugeWarn}>
            {" │ "}
            {gauge.text}
          </Text>
        )}{" "}
        │ {tokens}
      </Text>
      {budget >= hints.length ? <Text dimColor>{hints}</Text> : null}
    </Box>
  );
}
