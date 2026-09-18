import React from "react";
import { Box, Text, useStdout } from "ink";
import type { DisplayMessage } from "../hooks/useAgentController.js";
import { MarkdownView, parseMarkdownText } from "../markdown/MarkdownView.js";
import { useTheme } from "../theme/theme.js";
import { rule } from "../util/chrome.js";
import { displayWidth, formatTime } from "../util/format.js";
import { sanitizeTerminalText } from "../util/sanitize.js";
import { useBlink, useSpinnerFrame } from "../util/useSpinner.js";
import { ToolCallView } from "./ToolCallView.js";
import { SubAgentView } from "./SubAgentView.js";
import { VerificationCard } from "./VerificationCard.js";

export const MessageView = React.memo(function MessageView({ message, expandTools }: { message: DisplayMessage; expandTools?: boolean }) {
  const theme = useTheme();
  const { stdout } = useStdout();
  // Card headers: role label + rule; with /expand, a dim timestamp rides the
  // right edge (DW-2 deferred timestamps). Absent ts (resumed history) → bare.
  const showTime = expandTools === true && message.ts !== undefined;
  const timeText = showTime ? formatTime(message.ts as number) : "";
  const ruleRoom = (label: string): number => {
    const width = Math.max(20, (stdout?.columns ?? 80) - 4);
    const reserve = timeText ? displayWidth(timeText) + 2 : 0;
    return Math.max(4, width - displayWidth(label) - 1 - reserve);
  };
  const cardHeader = (label: string, color: string | undefined, bold?: boolean) => (
    <Box justifyContent="space-between" flexShrink={0} flexGrow={1}>
      <Text color={color} bold={bold}>
        {label} {rule(ruleRoom(label))}
      </Text>
      {timeText && <Text dimColor>{timeText}</Text>}
    </Box>
  );
  // DW-3.1 pulse = streaming wakefulness; DW-3.4 block cursor on live text.
  // (Hooks stay above the role early-returns — role never changes per instance.)
  const pulse = useSpinnerFrame(message.streaming, "pulse");
  const cursorOn = useBlink(message.streaming);
  if (message.role === "user") {
    return (
      <Box flexDirection="column">
        {cardHeader(theme.typography.userPrefix, theme.colors.textSecondary)}
        {message.images?.map((img) => (
          <Text key={img.path} color={theme.colors.dim}>
            {"  🖼 "}
            {img.path}
          </Text>
        ))}
        <Text color={theme.colors.userText}>{sanitizeTerminalText(message.text)}</Text>
      </Box>
    );
  }

  if (message.role === "system") {
    return (
      <Box flexDirection="column">
        <Text>
          <Text color={theme.colors.primary}>ℹ </Text>
          <Text color={theme.colors.userText}>{sanitizeTerminalText(message.text)}</Text>
        </Text>
      </Box>
    );
  }

  // Assistant text originates from the model: strip raw control characters
  // (\r, ANSI, tabs) before anything reaches the frame — Ink's row accounting
  // cannot survive them and the whole UI corrupts downstream.
  const safeText = sanitizeTerminalText(message.text);
  // Two-pass rendering: plain colored text while streaming —
  // never markdown-parse mid-flight (flicker rule) — then ONE re-render
  // through the bounded markdown renderer once the turn settles. Code fences
  // are highlighted inside MarkdownView, so no direct highlighter call here.
  // Cards render once below, for both states (sub-agent ids are position
  // counters — stable under appends, unlike task-text keys on duplicates).
  const textBlock = message.streaming ? (
    <Text color={theme.colors.assistantText}>
      {safeText ? `${safeText} ` : ""}
      {safeText ? (
        <Text color={theme.colors.accent}>{cursorOn ? "█" : " "}</Text>
      ) : (
        <>
          <Text color={theme.colors.accent}>{pulse}</Text>
          {message.toolCalls.length === 0 && <Text dimColor> thinking…</Text>}
        </>
      )}
    </Text>
  ) : (
    <MarkdownView blocks={parseMarkdownText(safeText)} />
  );
  return (
    <Box flexDirection="column">
      {cardHeader(theme.typography.assistantPrefix, theme.colors.brand, true)}
      {(safeText || message.streaming) && textBlock}
      {message.errorText && (
        <Text color={theme.colors.error}>✗ {sanitizeTerminalText(message.errorText)}</Text>
      )}
      {message.toolCalls.map((call) => (
        <ToolCallView key={call.id} call={call} expanded={expandTools} />
      ))}
      {message.verifications?.map((v) => (
        <VerificationCard key={v.id} verification={v} />
      ))}
      {message.subAgents.map((sub, i) => (
        <SubAgentView key={i} sub={sub} expanded={expandTools} />
      ))}
    </Box>
  );
});
