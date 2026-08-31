import { Box, Text } from "ink";
import type { DisplayToolCall } from "../hooks/useAgentController.js";
import { theme } from "../theme/theme.js";

function oneLine(text: string, max = 60): string {
  const first = text.split("\n")[0] ?? "";
  return first.length > max ? first.slice(0, max - 1) + "…" : first;
}

function describeCall(call: DisplayToolCall): string {
  if (call.summary) return oneLine(call.summary);
  return oneLine(JSON.stringify(call.input));
}

export function ToolCallView({ call }: { call: DisplayToolCall }) {
  const symbol =
    call.status === "running" ? "⋯" : call.status === "done" ? "✓" : "✗";
  const color =
    call.status === "running"
      ? theme.colors.toolRunning
      : call.status === "done"
        ? theme.colors.toolDone
        : theme.colors.toolError;
  return (
    <Box paddingLeft={2}>
      <Text color={color}>{symbol} </Text>
      <Text color={theme.colors.toolName}>{call.name}</Text>
      <Text dimColor> {describeCall(call)}</Text>
    </Box>
  );
}
