import { useState } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import type { AgentSession, CheckpointMeta } from "@anvil/core";
import { useTheme } from "../theme/theme.js";

export interface RewindModalProps {
  session: AgentSession;
  onSelect: (checkpointId: number) => void;
  onClose: () => void;
}

export function RewindModal({ session, onSelect, onClose }: RewindModalProps) {
  const theme = useTheme();
  const { stdout } = useStdout();
  const checkpoints: CheckpointMeta[] = session.getCheckpoints();
  const [selectedIdx, setSelectedIdx] = useState<number>(
    checkpoints.length > 0 ? checkpoints.length - 1 : 0
  );

  useInput((input, key) => {
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

  if (checkpoints.length === 0) {
    return (
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={theme.colors.border}
        paddingX={2}
        paddingY={1}
      >
        <Text bold color={theme.colors.primary}>
          Time-Travel Checkpoint Rewind
        </Text>
        <Text dimColor>No checkpoints recorded in this session yet.</Text>
        <Box marginTop={1}>
          <Text dimColor>Press Esc to close.</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.colors.accent}
      paddingX={2}
      paddingY={1}
      flexShrink={0}
      overflow="hidden"
    >
      <Box justifyContent="space-between" marginBottom={1}>
        <Text bold color={theme.colors.accent}>
          Time-Travel Checkpoint Rewind
        </Text>
        <Text dimColor>↑/↓: navigate · Enter: restore · Esc: cancel</Text>
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
              {start > 0 && <Text dimColor>  … {start} older checkpoint{start === 1 ? "" : "s"}</Text>}
              {rows.map((cp: CheckpointMeta) => {
                const idx = checkpoints.indexOf(cp);
                const isSelected = idx === selectedIdx;
                const timeStr = new Date(cp.ts).toLocaleTimeString();
                const fileText = `${cp.files} file${cp.files === 1 ? "" : "s"} snapshotted`;

                return (
                  <Box key={cp.id} gap={1}>
                    <Text color={isSelected ? theme.colors.accent : undefined} bold={isSelected}>
                      {isSelected ? "❯ " : "  "}
                      #{cp.id}
                    </Text>
                    <Text dimColor>({timeStr})</Text>
                    <Text color={isSelected ? theme.colors.assistantText : undefined}>
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
                <Text dimColor>
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
