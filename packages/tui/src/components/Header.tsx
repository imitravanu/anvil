import { Box, Text } from "ink";
import { MODEL_REGISTRY } from "@anvil/core";
import { useTheme } from "../theme/theme.js";

interface HeaderProps {
  model: string;
  isBusy: boolean;
}

export function Header({ model, isBusy }: HeaderProps) {
  const theme = useTheme();
  const info = MODEL_REGISTRY.find((m) => m.id === model);
  return (
    <Box justifyContent="space-between" paddingX={theme.spacing.panelPaddingX}>
      <Text bold color={theme.colors.primary}>▲ ANVIL</Text>
      <Text dimColor>
        {model}
        {info?.isFree ? (
          <Text color={theme.colors.toolDone} bold> [FREE]</Text>
        ) : null}
        {" · "}
        {isBusy ? "busy" : "idle"}
      </Text>
    </Box>
  );
}
