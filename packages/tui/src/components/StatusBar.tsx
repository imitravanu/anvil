import { Box, Text, useStdout } from "ink";
import { MODEL_REGISTRY } from "@anvil/core";
import type { UsageTotals } from "../hooks/useAgentController.js";
import { useTheme } from "../theme/theme.js";
import { contextGauge, curtail, displayModelLabel, formatPricingTag } from "../util/format.js";
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

  const leftPlain = `${curtail(modelLabel, 40)} │ ${statePlain}${checkpointPlain}${testPlain}${gaugePlain} │ ${tokens}`;
  const budget = width - Array.from(leftPlain).length - 6;

  return (
    <Box paddingX={theme.spacing.panelPaddingX} justifyContent="space-between">
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
        │ {tokens}
      </Text>
      {budget >= hints.length ? <Text dimColor>{hints}</Text> : null}
    </Box>
  );
}
