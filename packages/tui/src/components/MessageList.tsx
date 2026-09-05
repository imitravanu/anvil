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
      <Text dimColor>
        {provider ? providerLabel(provider) : "Anvil"} · {displayModelLabel(model)}
      </Text>
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

export function MessageList({ messages, model, expandTools, height }: { messages: DisplayMessage[]; model: string; expandTools?: boolean; height: number }) {
  // Shared bounded container for both states: bottom-anchored, clipped at the
  // top exactly like terminal scrollback. Before the flex fix, unbounded
  // content overflowed the fixed-height frame and Ink's default flex-shrink:1
  // squashed EVERY zone at once — chrome vanished, turns merged onto shared
  // rows, status bar overran the border (seen in real captures at 30 rows).
  // The chrome around this list is flexShrink={0}; overlays taller than the
  // basis (slash menu, permission prompt) borrow rows from here via
  // flexShrink instead of breaking the frame.
  if (messages.length === 0) {
    return (
      <Box
        flexDirection="column"
        flexGrow={1}
        flexShrink={1}
        minHeight={0}
        height={height}
        overflow="hidden"
        justifyContent="center"
      >
        <EmptyState model={model} />
      </Box>
    );
  }
  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      flexShrink={1}
      minHeight={0}
      height={height}
      overflow="hidden"
      paddingX={1}
      justifyContent="flex-end"
    >
      {messages.map((message, index) => (
        <Box key={message.id} marginTop={index > 0 ? 1 : 0} flexShrink={0}>
          <MessageView message={message} expandTools={expandTools} />
        </Box>
      ))}
    </Box>
  );
}
