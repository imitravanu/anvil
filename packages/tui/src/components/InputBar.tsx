import { useEffect, useRef, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import { useTheme } from "../theme/theme.js";
import { filterCommands } from "../commands/palette.js";
import { COMMANDS } from "../commands/registry.js";
import { CommandPalette } from "./CommandPalette.js";

interface InputBarProps {
  isBusy: boolean;
  onSubmit: (text: string) => void;
  onCancel: () => void;
  sentHistory?: string[]; // this session's sent messages, for Up/Down recall
  mruCommands?: readonly string[]; // most-recently-used slash commands first
}

export function InputBar({ isBusy, onSubmit, onCancel, sentHistory = [], mruCommands = [] }: InputBarProps) {
  const theme = useTheme();
  const { exit } = useApp();
  const [value, setValue] = useState("");
  const historyIndex = useRef(-1); // -1 = not recalling
  // DW-2.6 recall indicator: mirrors historyIndex in state (refs don't render).
  const [recalling, setRecalling] = useState(false);
  const [commandIndex, setCommandIndex] = useState(0);

  // Slash-command menu: shown automatically as soon as the input starts with
  // "/" (and no separate argument has been typed yet — "/session " turns it
  // off so the subcommand can be entered normally).
  const startsSlash = value.startsWith("/");
  const slashText = startsSlash ? value.slice(1) : "";
  const showCommandMenu = startsSlash && !slashText.includes(" ");
  // DW-3.2 palette matching: prefix first, then fuzzy, MRU-boosted. The
  // palette renders this same list, so highlight indices always align.
  const matchingCommands = showCommandMenu ? filterCommands(COMMANDS, slashText, mruCommands) : [];

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
        setRecalling(true);
      } else if (key.downArrow && historyIndex.current !== -1) {
        historyIndex.current += 1;
        if (historyIndex.current >= sentHistory.length) {
          historyIndex.current = -1;
          setValue("");
          setRecalling(false);
        } else {
          setValue(sentHistory[historyIndex.current]);
          setRecalling(true);
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
      // If there was text after the newline, the user pasted multiline content.
      // Do not prematurely submit the first line and corrupt the rest;
      // flatten newlines to spaces so the user sees the full draft.
      if (after.trim().length > 0) {
        const sanitized = raw.replace(/[\r\n]+/g, " ");
        setValue(sanitized);
        historyIndex.current = -1;
        setRecalling(false);
        return;
      }
      if (before.trim()) {
        onSubmit(before.trim());
      }
      setValue(after);
      historyIndex.current = -1;
      setRecalling(false);
      return;
    }
    // Typing after recall starts a new draft; Up/Down then starts again
    // from the newest sent message instead of overwriting the draft.
    if (raw !== value) {
      historyIndex.current = -1;
      setRecalling(false);
    }
    setValue(raw);
  };

  return (
    <Box flexDirection="column" flexShrink={0}>
      {/* DW-3.2 command palette — framed overlay above the input. */}
      {showCommandMenu && (
        <CommandPalette query={slashText} highlight={commandIndex} mru={mruCommands} />
      )}
      {/* DW-2.6 history recall indicator — only while browsing past input. */}
      {recalling && !showCommandMenu && (
        <Box paddingX={1} flexShrink={0}>
          <Text color={theme.colors.textMuted}>↑↓ browsing history — type to start a new draft</Text>
        </Box>
      )}
      <Box
        borderStyle={theme.borders.panel}
        // Bright (accent) while ready for input, dimmed while a turn streams
        // (the box is non-interactive then) — state you can see without text.
        borderColor={isBusy ? theme.colors.dim : theme.colors.accent}
        paddingX={theme.spacing.panelPaddingX}
      >
        <Text color={theme.colors.brand}>{"❯ "}</Text>
        <Box flexGrow={1}>
          <Text color={theme.colors.userText}>
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
                setRecalling(false);
              }}
            />
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
