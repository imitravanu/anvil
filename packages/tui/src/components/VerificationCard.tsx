import { Box, Text, useStdout } from "ink";
import type { DisplayVerification } from "../hooks/useAgentController.js";
import { useTheme } from "../theme/theme.js";
import { useSpinnerFrame } from "../util/useSpinner.js";
import { curtail } from "../util/format.js";
import { sanitizeTerminalText } from "../util/sanitize.js";

export function VerificationCard({ verification }: { verification: DisplayVerification }) {
  const theme = useTheme();
  const { stdout } = useStdout();
  const width = stdout?.columns ?? 80;
  const spinner = useSpinnerFrame(verification.status === "running");

  const borderColor =
    verification.status === "running"
      ? theme.colors.toolRunning
      : verification.status === "passed"
        ? theme.colors.toolDone
        : theme.colors.toolError;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={borderColor}
      paddingX={1}
      marginY={1}
    >
      <Box justifyContent="space-between">
        <Box gap={1}>
          {verification.status === "running" ? (
            <Text color={theme.colors.toolRunning}>{spinner} 🧪 </Text>
          ) : verification.status === "passed" ? (
            <Text color={theme.colors.toolDone}>✓ 🧪 </Text>
          ) : (
            <Text color={theme.colors.toolError}>✗ 🧪 </Text>
          )}
          <Text bold color={borderColor}>
            {verification.status === "running"
              ? "Closed-Loop TDD Auto-Verification..."
              : verification.status === "passed"
                ? "Test Suite Verified Green"
                : "Test Suite Regression Detected"}
          </Text>
        </Box>
        {/* The command shares the title row (space-between) — an uncurtailed
            long command wraps and grows the fixed-feel card. Verification
            summaries quote test-runner output (\r progress lines, ANSI). */}
        <Text dimColor>
          cmd: {curtail(sanitizeTerminalText(verification.command), Math.max(10, width - 46))}
        </Text>
      </Box>

      {verification.summary && (
        <Box paddingLeft={3}>
          <Text dimColor>{curtail(sanitizeTerminalText(verification.summary), 120)}</Text>
        </Box>
      )}

      {verification.repairsUsed > 0 && (
        <Box paddingLeft={3} marginTop={0}>
          <Text color={theme.colors.accent}>
            🔧 Auto-Repair Attempt {verification.repairsUsed}/2
            {verification.status === "running" ? " (analyzing failure & repairing...)" : " (applied)"}
          </Text>
        </Box>
      )}
    </Box>
  );
}
