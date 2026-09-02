import { Box, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import { useRef, useState } from "react";
import { useTheme } from "../theme/theme.js";

interface InputBarProps {
  isBusy: boolean;
  onSubmit: (text: string) => void;
  onCancel: () => void;
  sentHistory?: string[]; // this session's sent messages, for Up/Down recall
}

export function InputBar({ isBusy, onSubmit, onCancel, sentHistory = [] }: InputBarProps) {
  const theme = useTheme();
  const { exit } = useApp();
  const [value, setValue] = useState("");
  const historyIndex = useRef(-1); // -1 = not recalling

  useInput((_input, key) => {
    if (key.escape && isBusy) {
      onCancel();
      return;
    }
    // Ctrl+C: cancel while a turn is streaming (never kills the app mid-turn);
    // exit cleanly while idle.
    if (key.ctrl && _input === "c") {
      if (isBusy) {
        onCancel();
        return;
      }
      exit();
      return;
    }
    // History recall: only from an empty input, cycling newest → oldest on Up
    // and back on Down. In-memory, this session only.
    if (sentHistory.length > 0 && value === "") {
      if (key.upArrow) {
        historyIndex.current =
          historyIndex.current === -1
            ? sentHistory.length - 1
            : Math.max(0, historyIndex.current - 1);
        setValue(sentHistory[historyIndex.current]);
      } else if (key.downArrow && historyIndex.current !== -1) {
        historyIndex.current += 1;
        if (historyIndex.current >= sentHistory.length) {
          historyIndex.current = -1;
          setValue("");
        } else {
          setValue(sentHistory[historyIndex.current]);
        }
      }
    }
  });

  return (
    <Box borderStyle="round" borderColor={theme.colors.border} paddingX={theme.spacing.panelPaddingX}>
      <Text color={theme.colors.primary}>{"> "}</Text>
      <TextInput
        value={value}
        onChange={setValue}
        placeholder={isBusy ? "working… (Esc to cancel)" : "Type a message"}
        onSubmit={(text) => {
          const trimmed = text.trim();
          if (!trimmed || isBusy) return; // ignore input while a turn is in flight
          onSubmit(trimmed);
          setValue("");
        }}
      />
    </Box>
  );
}
