import { useEffect, useRef, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import { useTheme } from "../theme/theme.js";
import { COMMANDS } from "../commands/registry.js";

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
  const [commandIndex, setCommandIndex] = useState(0);

  // Slash-command menu: shown automatically as soon as the input starts with
  // "/" (and no separate argument has been typed yet — "/session " turns it
  // off so the subcommand can be entered normally).
  const startsSlash = value.startsWith("/");
  const slashText = startsSlash ? value.slice(1) : "";
  const showCommandMenu = startsSlash && !slashText.includes(" ");
  const matchingCommands = showCommandMenu
    ? COMMANDS.filter((c) => c.name.startsWith(slashText))
    : [];

  // Keep the highlight on a valid row as the filter changes.
  useEffect(() => {
    setCommandIndex(0);
  }, [matchingCommands.length, slashText]);

  useInput((_input, key) => {
    // Slash-menu keys take priority: Esc dismisses, arrows navigate, Tab fills.
    if (showCommandMenu) {
      if (key.escape) {
        setValue(""); // dismiss the menu and go back to typing
        return;
      }
      if (key.upArrow) {
        setCommandIndex((i) => Math.max(0, i - 1));
        return;
      }
      if (key.downArrow) {
        setCommandIndex((i) => Math.min(matchingCommands.length - 1, i + 1));
        return;
      }
      if (key.tab) {
        const command = matchingCommands[commandIndex];
        if (command) {
          setValue(`/${command.name} `); // trailing space lets you type args
          setCommandIndex(0);
        }
        return;
      }
    }

    if (key.escape && isBusy) {
      onCancel();
      return;
    }
    // Ctrl+C: cancel while a turn is streaming (never kills the app mid-turn);
    // exit cleanly while idle. Ink delivers Ctrl+C as "c" with key.ctrl set
    // (use-input.js maps ctrl keys to keypress.name); accept the raw \x03 byte
    // too, in case a future Ink version changes that mapping.
    if (key.ctrl && (_input === "c" || _input === "\x03")) {
      if (isBusy) {
        onCancel();
        return;
      }
      exit();
      return;
    }
    // History recall: only when NOT driving the slash menu, from an empty input
    // (or continuing from a recalled entry), cycling newest → oldest on Up and
    // back on Down. In-memory, this session only.
    if (
      !showCommandMenu &&
      sentHistory.length > 0 &&
      (value === "" || historyIndex.current !== -1)
    ) {
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
    <Box flexDirection="column">
      {/* Slash-command autocomplete menu — appears on "/" */}
      {showCommandMenu && (
        <Box flexDirection="column" paddingX={1}>
          {matchingCommands.length === 0 ? (
            <Text dimColor>No matching commands.</Text>
          ) : (
            matchingCommands.map((command, i) => (
              <Text key={command.name} color={i === commandIndex ? theme.colors.primary : undefined}>
                {i === commandIndex ? "❯ " : "  "}
                <Text color={theme.colors.toolName}>/{command.name}</Text> — {command.description}
                {i === commandIndex ? "   (Tab fill · Enter run)" : ""}
              </Text>
            ))
          )}
        </Box>
      )}
      <Box
        borderStyle="round"
        // Bright (accent) while ready for input, dimmed while a turn streams
        // (the box is non-interactive then) — state you can see without text.
        borderColor={isBusy ? theme.colors.dim : theme.colors.accent}
        paddingX={theme.spacing.panelPaddingX}
      >
        <Text color={theme.colors.primary}>{"> "}</Text>
        <TextInput
          value={value}
          onChange={(nextValue) => {
            // Typing after recall starts a new draft; Up/Down then starts again
            // from the newest sent message instead of overwriting the draft.
            if (nextValue !== value) historyIndex.current = -1;
            setValue(nextValue);
          }}
          placeholder={isBusy ? "working… (Esc to cancel)" : "Type a message, / for commands"}
          onSubmit={(text) => {
            // Enter with the slash menu open runs the highlighted command.
            if (showCommandMenu && matchingCommands[commandIndex]) {
              onSubmit(`/${matchingCommands[commandIndex].name}`);
              setValue("");
              setCommandIndex(0);
              return;
            }
            const trimmed = text.trim();
            if (!trimmed || isBusy) return; // ignore input while a turn is in flight
            onSubmit(trimmed);
            setValue("");
            historyIndex.current = -1;
          }}
        />
      </Box>
    </Box>
  );
}
