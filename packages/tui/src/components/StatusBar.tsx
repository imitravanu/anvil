import { Box, Text } from "ink";
import { MODEL_REGISTRY } from "@anvil/core";
import type { UsageTotals } from "../hooks/useAgentController.js";
import { useTheme } from "../theme/theme.js";

interface StatusBarProps {
  model: string;
  isBusy: boolean;
  usage: UsageTotals;
}

const fmt = (n: number): string => n.toLocaleString("en-US");

export function StatusBar({ model, isBusy, usage }: StatusBarProps) {
  const theme = useTheme();
  const info = MODEL_REGISTRY.find((m) => m.id === model);
  // The hints reflect the actual key bindings: while a turn streams, Esc and
  // Ctrl+C both cancel; while idle, Ctrl+C exits.
  const hints = isBusy ? "esc cancel · ctrl+c cancel" : "ctrl+c exit · /help";
  return (
    <Box paddingX={theme.spacing.panelPaddingX}>
      <Text dimColor>
        {model}
        {info?.isFree ? (
          <Text color={theme.colors.toolDone} bold> [FREE]</Text>
        ) : null}
      </Text>
      <Text dimColor> │ </Text>
      <Text color={isBusy ? theme.colors.primary : undefined} dimColor={!isBusy}>
        ●
      </Text>
      <Text dimColor> {isBusy ? "busy" : "idle"}</Text>
      <Text dimColor>
        {" │ "}
        tokens {fmt(usage.inputTokens)} in · {fmt(usage.outputTokens)} out
      </Text>
      <Text dimColor> │ {hints}</Text>
    </Box>
  );
}
