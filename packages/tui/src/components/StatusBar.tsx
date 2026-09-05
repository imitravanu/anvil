import { Box, Text, useStdout } from "ink";
import { MODEL_REGISTRY } from "@anvil/core";
import type { UsageTotals } from "../hooks/useAgentController.js";
import { useTheme } from "../theme/theme.js";
import { displayModelLabel, curtail, formatPricingTag } from "../util/format.js";
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

  const leftPlain = `${curtail(modelLabel, 48)} │ ${statePlain} │ ${tokens}`;
  const budget = width - leftPlain.length - 6;
  // Hints are hidden (never clipped/wrapped) when they cannot fit.
  return (
    <Box paddingX={theme.spacing.panelPaddingX} justifyContent="space-between">
      <Text dimColor>
        {curtail(modelLabel, 48)} │ {state} │ {tokens}
      </Text>
      {budget >= hints.length ? <Text dimColor>{hints}</Text> : null}
    </Box>
  );
}
