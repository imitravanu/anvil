import { Box, Text } from "ink";
import type { DisplayMessage } from "../hooks/useAgentController.js";
import { MarkdownView, parseMarkdownText } from "../markdown/MarkdownView.js";
import { useTheme } from "../theme/theme.js";
import { useSpinnerFrame } from "../util/useSpinner.js";
import { ToolCallView } from "./ToolCallView.js";

export function MessageView({ message }: { message: DisplayMessage }) {
  const theme = useTheme();
  const spinner = useSpinnerFrame(message.streaming);
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

  // Two-pass rendering (Phase 8 C2): plain colored text while streaming —
  // never markdown-parse mid-flight (flicker rule) — then ONE re-render
  // through the bounded markdown renderer once the turn settles. Code fences
  // are highlighted inside MarkdownView, so no direct highlighter call here.
  if (message.streaming) {
    return (
      <Box flexDirection="column">
        <Text bold color={theme.colors.primary}>
          anvil
        </Text>
        <Text color={theme.colors.assistantText}>
          {message.text ? `${message.text} ` : ""}
          <Text color={theme.colors.accent}>{spinner}</Text>
        </Text>
        {message.toolCalls.map((call) => (
          <ToolCallView key={call.id} call={call} />
        ))}
      </Box>
    );
  }
  return (
    <Box flexDirection="column">
      <Text bold color={theme.colors.primary}>
        anvil
      </Text>
      <MarkdownView blocks={parseMarkdownText(message.text)} />
      {message.toolCalls.map((call) => (
        <ToolCallView key={call.id} call={call} />
      ))}
    </Box>
  );
}
