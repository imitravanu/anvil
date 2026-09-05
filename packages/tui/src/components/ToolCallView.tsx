import { Box, Text } from "ink";
import type { DisplayToolCall } from "../hooks/useAgentController.js";
import { useTheme } from "../theme/theme.js";
import { formatToolOutput } from "../util/toolOutput.js";
import { useSpinnerFrame } from "../util/useSpinner.js";

function oneLine(text: string, max = 60): string {
  const first = text.split("\n")[0] ?? "";
  return first.length > max ? first.slice(0, max - 1) + "…" : first;
}

function describeCall(call: DisplayToolCall): string {
  if (call.summary) return oneLine(call.summary);
  return oneLine(JSON.stringify(call.input));
}

export function ToolCallView({ call, expanded }: { call: DisplayToolCall; expanded?: boolean }) {
  const theme = useTheme();
  const spinner = useSpinnerFrame(call.status === "running");
  const symbol = call.status === "running" ? spinner : call.status === "done" ? "✓" : "✗";
  const color =
    call.status === "running"
      ? theme.colors.toolRunning
      : call.status === "done"
        ? theme.colors.toolDone
        : theme.colors.toolError;
  return (
    <Box flexDirection="column">
      <Box paddingLeft={3}>
        <Text color={color}>{symbol} </Text>
        <Text color={theme.colors.toolName}>{call.name}</Text>
        <Text dimColor> {describeCall(call)}</Text>
      </Box>
      {expanded && call.status !== "running" && (
        <Box paddingLeft={5} flexDirection="column">
          {formatToolOutput(call.output).map((line, i) => (
            <Text key={i} dimColor>
              {line}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  );
}
