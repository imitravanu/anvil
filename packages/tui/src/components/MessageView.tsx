import { Box, Text } from "ink";
import type { DisplayMessage } from "../hooks/useAgentController.js";
import { highlightCodeBlocks } from "../markdown/highlightCodeBlocks.js";
import { useTheme } from "../theme/theme.js";
import { ToolCallView } from "./ToolCallView.js";

export function MessageView({ message }: { message: DisplayMessage }) {
  const theme = useTheme();
  if (message.role === "user") {
    return (
      <Box flexDirection="column">
        <Text dimColor>❯ you</Text>
        <Text color={theme.colors.userText}>{message.text}</Text>
      </Box>
    );
  }

  if (message.role === "system") {
    return (
      <Box flexDirection="column">
        <Text dimColor italic>
          ℹ {message.text}
        </Text>
      </Box>
    );
  }

  // Two-pass rendering: plain (but colored) text while streaming; once the
  // turn settles, re-render once with fenced code blocks syntax-highlighted.
  // The highlighted form is rendered WITHOUT an outer color so the
  // highlighter's own ANSI colors are what the terminal shows.
  const body = message.streaming ? message.text : highlightCodeBlocks(message.text);
  return (
    <Box flexDirection="column">
      <Text bold color={theme.colors.primary}>
        anvil
      </Text>
      <Text color={message.streaming ? theme.colors.assistantText : undefined}>
        {body || (message.streaming ? "…" : "")}
      </Text>
      {message.toolCalls.map((call) => (
        <ToolCallView key={call.id} call={call} />
      ))}
    </Box>
  );
}
