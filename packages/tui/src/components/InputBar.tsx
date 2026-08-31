import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { useState } from "react";
import { theme } from "../theme/theme.js";

interface InputBarProps {
  isBusy: boolean;
  onSubmit: (text: string) => void;
  onCancel: () => void;
}

export function InputBar({ isBusy, onSubmit, onCancel }: InputBarProps) {
  const [value, setValue] = useState("");

  useInput((_input, key) => {
    if (key.escape && isBusy) onCancel();
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
