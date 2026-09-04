import { Box, Text, useStdout } from "ink";
import { MODEL_REGISTRY } from "@anvil/core";
import type { UsageTotals } from "../hooks/useAgentController.js";
import { useTheme } from "../theme/theme.js";
import { displayModelLabel, curtail } from "../util/format.js";
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

  const modelLabel = `${displayModelLabel(model)}${info?.isFree ? " [FREE]" : ""}`;
  const state = isBusy ? `${busyFrame} busy` : "○ idle";
  const tokens = `tokens ${fmt(usage.inputTokens)} in · ${fmt(usage.outputTokens)} out`;
  const hints = isBusy ? "esc cancel · ctrl+c cancel" : "ctrl+c exit · /help";

  const left = `${curtail(modelLabel, 48)} │ ${state} │ ${tokens}`;
  const budget = width - left.length - 6;
  // Hints are hidden (never clipped/wrapped) when they cannot fit.
  return (
    <Box paddingX={theme.spacing.panelPaddingX} justifyContent="space-between">
      <Text dimColor>{left}</Text>
      {budget >= hints.length ? (
        <Text dimColor>{hints}</Text>
      ) : (
        <Text dimColor>{curtail(hints, Math.max(0, budget))}</Text>
      )}
    </Box>
  );
}
