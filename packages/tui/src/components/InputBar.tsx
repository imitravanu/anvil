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
    // Esc: cancel a busy turn FIRST (the one thing a user must always be able
    // to reach), then dismiss the slash menu.
    if (key.escape) {
      if (isBusy) {
        onCancel();
        return;
      }
      if (showCommandMenu) {
        setValue(""); // dismiss the menu and go back to typing
        return;
      }
    }
    // Slash-menu keys: arrows navigate, Tab fills.
    if (showCommandMenu) {
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

  // THE line-stacking bug: when keystrokes arrive batched in one read (fast
  // typing, paste, tmux/SSH), Ink delivers e.g. "hi\r" as a single chunk — and
  // ink-text-input only sets key.return for a LONE "\r", so the return falls
  // into its insert branch and is embedded into the value. A raw control
  // character in a rendered frame line desyncs the terminal's column/row
  // accounting, and every later redraw lands on the wrong rows — the "lines
  // stack and interfere" corruption. Sanitize the value here and treat an
  // embedded return as submit (text after it becomes the new draft).
  const handleTextInputChange = (raw: string) => {
    if (/[\r\n]/.test(raw)) {
      const idx = raw.search(/[\r\n]/);
      const before = raw.slice(0, idx);
      const after = raw.slice(idx + 1).replace(/[\r\n]+/g, "");
      if (before.trim()) {
        onSubmit(before.trim());
      }
      setValue(after);
      historyIndex.current = -1;
      return;
    }
    // Typing after recall starts a new draft; Up/Down then starts again
    // from the newest sent message instead of overwriting the draft.
    if (raw !== value) historyIndex.current = -1;
    setValue(raw);
  };

  return (
    <Box flexDirection="column" flexShrink={0}>
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
          onChange={handleTextInputChange}
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
            if (!trimmed) return;
            // Busy is fine: handleSubmit routes to the queue and the drain
            // sends it when the turn settles.
            onSubmit(trimmed);
            setValue("");
            historyIndex.current = -1;
          }}
        />
      </Box>
    </Box>
  );
}
