import { Box, Text } from "ink";
import { useTheme } from "../theme/theme.js";

export function Header({ model }: { model: string }) {
  const theme = useTheme();
  return (
    <Box borderStyle="round" borderColor={theme.colors.border} paddingX={theme.spacing.panelPaddingX}>
      <Text bold color={theme.colors.primary}>ANVIL</Text>
      <Text dimColor> — {model} — type a message, Enter to send, Esc to cancel</Text>
    </Box>
  );
}
