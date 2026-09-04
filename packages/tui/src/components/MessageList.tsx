import { Box, Text, useStdout } from "ink";
import { CORE_VERSION } from "@anvil/core";
import type { DisplayMessage } from "../hooks/useAgentController.js";
import { useTheme } from "../theme/theme.js";
import { MessageView } from "./MessageView.js";
import { displayModelLabel, providerLabel, providerOfModel } from "../util/format.js";

function EmptyState({ model }: { model: string }) {
  const theme = useTheme();
  const provider = providerOfModel(model);
  return (
    <Box flexDirection="column" alignItems="center" justifyContent="center" flexGrow={1}>
      <Text color={theme.colors.primary} bold>▲ ANVIL</Text>
      <Text dimColor>Terminal coding agent</Text>
      {provider && (
        <Text dimColor>
          {providerLabel(provider)} · {displayModelLabel(model)}
        </Text>
      )}
      <Box marginTop={1} flexDirection="column">
        <Text dimColor>Try:</Text>
        <Text><Text color={theme.colors.primary}>/help</Text><Text dimColor> — list commands</Text></Text>
        <Text><Text color={theme.colors.primary}>/model</Text><Text dimColor> — switch model or provider</Text></Text>
        <Text><Text color={theme.colors.primary}>/session</Text><Text dimColor> — resume a past conversation</Text></Text>
        <Text><Text color={theme.colors.primary}>/connect</Text><Text dimColor> — add or update a provider API key</Text></Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>v{CORE_VERSION}</Text>
      </Box>
    </Box>
  );
}

export function MessageList({ messages, model }: { messages: DisplayMessage[]; model: string }) {
  const { stdout } = useStdout();
  const rows = stdout?.rows ?? 24;
  if (messages.length === 0) {
    return <EmptyState model={model} />;
  }
  // Ink has no native scroll — approximate "last N that fit" by capping the
  // number of rendered messages relative to the terminal height. With the
  // outer frame's chrome (borders, header, dividers, input, status bar) each
  // turn now costs ~3 rows: role label, text, and the blank line between turns.
  const maxMessages = Math.max(1, Math.floor((rows - 9) / 3));
  const visible = messages.slice(-maxMessages);
  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1} justifyContent="flex-end">
      {visible.map((message, index) => (
        <Box key={message.id} marginTop={index > 0 ? 1 : 0}>
          <MessageView message={message} />
        </Box>
      ))}
    </Box>
  );
}
