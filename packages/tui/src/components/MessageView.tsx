import { Box, Text } from "ink";
import type { DisplayMessage } from "../hooks/useAgentController.js";
import { MarkdownView, parseMarkdownText } from "../markdown/MarkdownView.js";
import { useTheme } from "../theme/theme.js";
import { useSpinnerFrame } from "../util/useSpinner.js";
import { ToolCallView } from "./ToolCallView.js";
import { SubAgentView } from "./SubAgentView.js";

export function MessageView({ message, expandTools }: { message: DisplayMessage; expandTools?: boolean }) {
  const theme = useTheme();
  // Streaming caret: a single braille-spinner implementation.
  const spinner = useSpinnerFrame(message.streaming);
  if (message.role === "user") {
    return (
      <Box flexDirection="column">
        <Text dimColor>❯ you</Text>
        {message.images?.map((img) => (
          <Text key={img.path} dimColor>
            {"  🖼 "}
            {img.path}
          </Text>
        ))}
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

  // Two-pass rendering: plain colored text while streaming —
  // never markdown-parse mid-flight (flicker rule) — then ONE re-render
  // through the bounded markdown renderer once the turn settles. Code fences
  // are highlighted inside MarkdownView, so no direct highlighter call here.
  // Cards render once below, for both states (sub-agent ids are position
  // counters — stable under appends, unlike task-text keys on duplicates).
  const textBlock = message.streaming ? (
    <Text color={theme.colors.assistantText}>
      {message.text ? `${message.text} ` : ""}
      <Text color={theme.colors.accent}>{spinner}</Text>
      {!message.text && message.toolCalls.length === 0 && (
        <Text dimColor> thinking…</Text>
      )}
    </Text>
  ) : (
    <MarkdownView blocks={parseMarkdownText(message.text)} />
  );
  return (
    <Box flexDirection="column">
      <Text bold color={theme.colors.primary}>
        anvil
      </Text>
      {(message.text || message.streaming) && textBlock}
      {message.errorText && (
        <Text color={theme.colors.toolError}>✗ {message.errorText}</Text>
      )}
      {message.toolCalls.map((call) => (
        <ToolCallView key={call.id} call={call} expanded={expandTools} />
      ))}
      {message.subAgents.map((sub, i) => (
        <SubAgentView key={i} sub={sub} expanded={expandTools} />
      ))}
    </Box>
  );
}
