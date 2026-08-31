import { Box, Text } from "ink";
import { theme } from "../theme/theme.js";

export function Header({ model }: { model: string }) {
  return (
    <Box borderStyle="round" borderColor={theme.colors.border} paddingX={theme.spacing.panelPaddingX}>
      <Text bold color={theme.colors.primary}>ANVIL</Text>
      <Text dimColor> — {model} — type a message, Enter to send, Esc to cancel</Text>
    </Box>
  );
}
