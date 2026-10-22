import { useState } from "react";
import { Box, Text, useStdout } from "ink";
import { useInput, usePaste } from "../hooks/useUIInput.js";
import type { AgentSession, CheckpointMeta } from "@imitravanu/anvil-core";
import { useTheme } from "../theme/theme.js";
import { formatTime } from "../util/format.js";
import { windowOffset } from "../hooks/useWindowedList.js";
import { MAX_VISIBLE_ROWS } from "../util/displayLimits.js";
import { OverlayFrame } from "./OverlayFrame.js";

export interface RewindModalProps {
  minimal?: boolean;
  session: AgentSession;
  onSelect: (checkpointId: number) => void;
  onClose: () => void;
}

export function RewindModal({ session, onSelect, onClose, minimal = false }: RewindModalProps) {
  const theme = useTheme();
  const { stdout } = useStdout();
  const checkpoints: CheckpointMeta[] = session.getCheckpoints();
  const [selectedIdx, setSelectedIdx] = useState<number>(
    checkpoints.length > 0 ? checkpoints.length - 1 : 0
  );

  usePaste(() => { /* intentional: restoring files requires a typed selection, never paste. */ });
  useInput((input, key) => {
    if (key.ctrl || key.meta) return;
    if (key.escape || input === "q") {
      onClose();
      return;
    }

    if (checkpoints.length > 0) {
      if (key.upArrow || input === "k") {
        setSelectedIdx((prev: number) => Math.max(0, prev - 1));
      } else if (key.downArrow || input === "j") {
        setSelectedIdx((prev: number) => Math.min(checkpoints.length - 1, prev + 1));
      } else if (key.return) {
        const target = checkpoints[selectedIdx];
        if (target) {
          onSelect(target.id);
        }
      }
    }
  });
  if (minimal) {
    const budget = Math.max(1, Math.min(MAX_VISIBLE_ROWS, (stdout?.rows ?? 24) - 10));
    const { offset, hasAbove, hasBelow } = windowOffset(checkpoints.length, selectedIdx, budget);
    return <OverlayFrame minimal title="Restore checkpoint" hints="↑/↓ select · Enter restore · Esc close">
      <Text color={theme.colors.textSecondary}>Restores file snapshots. Conversation is kept; external edits are protected.</Text>
      {!checkpoints.length && <Text color={theme.colors.textSecondary}>No checkpoints recorded yet.</Text>}
      {hasAbove && <Text color={theme.colors.textSecondary}>↑ earlier checkpoints</Text>}
      {checkpoints.slice(offset, offset + budget).map((checkpoint, index) => <Text key={checkpoint.id} color={index + offset === selectedIdx ? theme.colors.textPrimary : theme.colors.textSecondary} wrap="truncate-end">{index + offset === selectedIdx ? "› " : "  "}#{checkpoint.id} · {checkpoint.files} files · {formatTime(new Date(checkpoint.ts).getTime())}</Text>)}
      {hasBelow && <Text color={theme.colors.textSecondary}>↓ newer checkpoints</Text>}
    </OverlayFrame>;
  }

  if (checkpoints.length === 0) {
    return (
      <Box
        flexDirection="column"
        borderStyle={theme.borders.modal}
        borderColor={theme.colors.border}
        paddingX={2}
        paddingY={1}
      >
        <Text bold color={theme.colors.primary}>
          Time-Travel Checkpoint Rewind
        </Text>
        <Text color={theme.colors.textSecondary}>No checkpoints recorded in this session yet.</Text>
        <Box marginTop={1}>
          <Text color={theme.colors.textSecondary}>Press Esc to close.</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box
      flexDirection="column"
      borderStyle={theme.borders.modal}
      // DW-3.3 focus signal: owns keystrokes while mounted.
      borderColor={theme.colors.borderFocus}
      paddingX={2}
      paddingY={1}
      flexShrink={0}
      overflow="hidden"
    >
      <Box justifyContent="space-between" marginBottom={1}>
        <Text bold color={theme.colors.accent}>
          Time-Travel Checkpoint Rewind
        </Text>
        <Text color={theme.colors.textSecondary}>↑/↓: navigate · Enter: restore · Esc: cancel</Text>
      </Box>

      {/* Sliding window around the selection — a long session must not make
          the modal taller than the frame (row stacking). */}
      <Box flexDirection="column" gap={0}>
        {(() => {
          const windowSize = 8;
          const start = Math.max(0, Math.min(selectedIdx - windowSize + 1, checkpoints.length - windowSize));
          const rows = checkpoints.slice(start, start + windowSize);
          return (
            <>
              {start > 0 && <Text color={theme.colors.textSecondary}>  … {start} older checkpoint{start === 1 ? "" : "s"}</Text>}
              {rows.map((cp: CheckpointMeta) => {
                const idx = checkpoints.indexOf(cp);
                const isSelected = idx === selectedIdx;
                // AUDIT-15: formatTime (manual HH:MM) instead of
                // toLocaleTimeString — the locale API's output format varies
                // across machines, which is exactly what format.ts exists to
                // avoid (it made visual baselines flaky).
                const timeStr = formatTime(new Date(cp.ts).getTime());
                const fileText = `${cp.files} file${cp.files === 1 ? "" : "s"} snapshotted`;

                return (
                  <Box key={cp.id} gap={1}>
                    <Text color={isSelected ? theme.colors.accent : theme.colors.primary} bold={isSelected}>
                      {isSelected ? "❯ " : "  "}
                      #{cp.id}
                    </Text>
                    <Text color={theme.colors.textMuted}>({timeStr})</Text>
                    <Text color={isSelected ? theme.colors.assistantText : theme.colors.userText}>
                      {fileText}
                    </Text>
                    {isSelected && (
                      <Text color={theme.colors.toolDone} bold>
                        [Press Enter to restore]
                      </Text>
                    )}
                  </Box>
                );
              })}
              {start + rows.length < checkpoints.length && (
                <Text color={theme.colors.textSecondary}>
                  … {checkpoints.length - start - rows.length} newer checkpoint{checkpoints.length - start - rows.length === 1 ? "" : "s"}
                </Text>
              )}
            </>
          );
        })()}
      </Box>
    </Box>
  );
}
