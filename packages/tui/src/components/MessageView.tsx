import { Box, Text } from "ink";
import type { DisplayMessage } from "../hooks/useAgentController.js";
import { MarkdownView, parseMarkdownText } from "../markdown/MarkdownView.js";
import { useTheme } from "../theme/theme.js";
import { useSpinnerFrame } from "../util/useSpinner.js";
import { ToolCallView } from "./ToolCallView.js";
import { SubAgentView } from "./SubAgentView.js";

export function MessageView({ message, expandTools }: { message: DisplayMessage; expandTools?: boolean }) {
  const theme = useTheme();
  // U2 streaming caret: the interrupted session already implemented this as a
  // braille spinner after the streaming text (consistent with ToolCallView) —
  // kept as the single implementation; my blink-caret variant was removed as
  // redundant (recorded in PHASE-8-PROGRESS.md §5).
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
          <ToolCallView key={call.id} call={call} expanded={expandTools} />
        ))}
        {message.subAgents.map((sub, i) => (
          <SubAgentView key={`${sub.task}-${i}`} sub={sub} expanded={expandTools} />
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
        <ToolCallView key={call.id} call={call} expanded={expandTools} />
      ))}
      {message.subAgents.map((sub, i) => (
        <SubAgentView key={`${sub.task}-${i}`} sub={sub} expanded={expandTools} />
      ))}
    </Box>
  );
}
