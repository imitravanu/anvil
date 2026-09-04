import { Box, Text } from "ink";
import { MODEL_REGISTRY } from "@anvil/core";
import { useTheme } from "../theme/theme.js";
import { curtail, displayModelLabel, providerOfModel, providerLabel } from "../util/format.js";

interface HeaderProps {
  model: string;
  isBusy: boolean;
}

export function Header({ model, isBusy }: HeaderProps) {
  const theme = useTheme();
  const info = MODEL_REGISTRY.find((m) => m.id === model);
  const provider = info ? providerLabel(providerOfModel(model) ?? info.providerId) : "Anvil";
  const modelName = displayModelLabel(model);
  const right = `${provider} · ${modelName}${info?.isFree ? " [FREE]" : ""}`;
  return (
    <Box justifyContent="space-between" paddingX={theme.spacing.panelPaddingX}>
      <Text bold color={theme.colors.primary}>▲ ANVIL</Text>
      <Text dimColor>
        {curtail(right, 70)}
        {" · "}
        {isBusy ? "busy" : "idle"}
      </Text>
    </Box>
  );
}
