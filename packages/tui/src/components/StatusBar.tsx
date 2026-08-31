import { Box, Text } from "ink";
import type { UsageTotals } from "../hooks/useAgentController.js";
import { theme } from "../theme/theme.js";

interface StatusBarProps {
  model: string;
  isBusy: boolean;
  usage: UsageTotals;
}

export function StatusBar({ model, isBusy, usage }: StatusBarProps) {
  return (
    <Box paddingX={theme.spacing.panelPaddingX}>
      <Text dimColor>
        {model} · {isBusy ? "● busy" : "○ idle"} · tokens in={usage.inputTokens} out=
        {usage.outputTokens}
      </Text>
    </Box>
  );
}
