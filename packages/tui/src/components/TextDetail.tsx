import { useState } from "react";
import { Box, Text, useStdout } from "ink";
import { useInput, usePaste } from "../hooks/useUIInput.js";
import { useTheme } from "../theme/theme.js";
import { ScrollViewport } from "./ScrollViewport.js";
import { sanitizeTerminalText } from "../util/sanitize.js";

export function TextDetail({ title, text, onClose }: { title: string; text: string; onClose: () => void }) {
  const theme = useTheme();
  const { stdout } = useStdout();
  const page = Math.max(1, (stdout?.rows ?? 24) - 6);
  const [maximum, setMaximum] = useState(0);
  const [offset, setOffset] = useState(Number.MAX_SAFE_INTEGER);
  usePaste(() => { /* intentional: read-only details do not interpret pasted shortcuts. */ });
  useInput((input, key) => {
    if (key.ctrl || key.meta) return;
    if (key.escape) onClose();
    else if (key.upArrow || key.pageUp) setOffset(value => Math.min(maximum, Math.min(maximum, value) + (key.pageUp ? page : 1)));
    else if (key.downArrow || key.pageDown) setOffset(value => Math.max(0, Math.min(value, maximum) - (key.pageDown ? page : 1)));
    else if (key.home) setOffset(maximum);
    else if (key.end) setOffset(0);
  });
  return <Box flexDirection="column" flexGrow={1} minHeight={0}>
    <Text bold color={theme.colors.textPrimary}>{title}</Text>
    <ScrollViewport offset={offset} onBounds={setMaximum}><Text color={theme.colors.textPrimary}>{sanitizeTerminalText(text)}</Text></ScrollViewport>
    <Text color={theme.colors.textSecondary}>↑/↓ scroll · PgUp/PgDn page · Home/End · Esc close</Text>
  </Box>;
}
