import { useEffect, useRef, useState } from "react";
import { getErrorMessage } from "@imitravanu/anvil-core";
import { Box, Text, useApp, useStdout } from "ink";
import { useInput, usePaste } from "../hooks/useUIInput.js";
import { useTheme } from "../theme/theme.js";
import { filterCommands } from "../commands/palette.js";
import { COMMANDS } from "../commands/registry.js";
import { CommandPalette } from "./CommandPalette.js";
import { sanitizeTerminalText } from "../util/sanitize.js";
import { curtailToCells, displayWidth } from "../util/format.js";
import { sectionRule } from "../util/chrome.js";
import { COMPOSER_MAX_CHARS, COMPOSER_MAX_ROWS, COMPOSER_SESSION_CAP } from "../util/displayLimits.js";

interface Draft { text: string; cursor: number; literal: boolean }
interface InputBarProps {
  sessionId?: string;
  hidden?: boolean;
  handleCtrlC?: boolean;
  isBusy: boolean;
  hasFocus?: boolean;
  onSlashMenuChange?: (open: boolean) => void;
  onSubmit: (text: string, literal?: boolean) => void | boolean | Promise<void | boolean>;
  onCancel: () => void;
  sentHistory?: string[];
  mruCommands?: readonly string[];
  onOpenHelp?: () => void;
}
const emptyDraft = (): Draft => ({ text: "", cursor: 0, literal: false });
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
function boundaries(text: string): number[] {
  return [...graphemes.segment(text)].map(segment => segment.index).concat(text.length);
}

export function InputBar({ sessionId = "default", hidden = false, isBusy, handleCtrlC = true,
  hasFocus = true, onSlashMenuChange, onSubmit, onCancel, sentHistory = [], mruCommands = [], onOpenHelp }: InputBarProps) {
  const theme = useTheme();
  const { stdout } = useStdout();
  const { exit } = useApp();
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const draft = drafts[sessionId] ?? emptyDraft();
  const [menuDismissed, setMenuDismissed] = useState(false);
  const [commandIndex, setCommandIndex] = useState(0);
  const [notice, setNotice] = useState("");
  const history = useRef({ index: -1, original: emptyDraft() });
  const submitting = useRef(false);
  const active = hasFocus && !hidden;
  const showMenu = !hidden && !menuDismissed && !draft.literal && draft.text.startsWith("/") && !/\s/.test(draft.text);
  const query = draft.text.slice(1);
  const matches = showMenu ? filterCommands(COMMANDS, query, mruCommands) : [];
  const change = (next: Draft) => {
    if (!drafts[sessionId] && next.text && Object.values(drafts).filter(item => item.text.length > 0).length >= COMPOSER_SESSION_CAP) {
      setNotice("Draft capacity reached. Finish or clear an existing session draft before creating another."); return false;
    }
    setDrafts(previous => ({ ...Object.fromEntries(Object.entries(previous).filter(([, item]) => item.text.length > 0)), [sessionId]: next }));
    return true;
  };
  useEffect(() => { setCommandIndex(0); }, [query]);
  useEffect(() => { onSlashMenuChange?.(showMenu); }, [showMenu, onSlashMenuChange]);
  useEffect(() => {
    history.current.index = -1;
    setNotice(""); setMenuDismissed(false);
  }, [sessionId]);
  const insert = (raw: string, pasted: boolean) => {
    const text = sanitizeTerminalText(raw.replace(/\r\n?/g, "\n"));
    if (draft.text.length + text.length > COMPOSER_MAX_CHARS) {
      setNotice("Draft limit reached. Split the message; your existing draft is preserved."); return;
    }
    if (!change({ text: draft.text.slice(0, draft.cursor) + text + draft.text.slice(draft.cursor),
      cursor: draft.cursor + text.length, literal: draft.literal || pasted })) return;
    history.current.index = -1;
    setMenuDismissed(false); setNotice("");
  };
  usePaste(text => insert(text, true), { isActive: active });
  const submit = async () => {
    if (submitting.current || !draft.text.trim()) return;
    const text = showMenu && matches[commandIndex] ? `/${matches[commandIndex].name}` : draft.text;
    submitting.current = true;
    try {
      const accepted = await (draft.literal ? onSubmit(text, true) : onSubmit(text));
      if (accepted !== false) {
        setDrafts(previous => previous[sessionId] === draft ? { ...previous, [sessionId]: emptyDraft() } : previous);
        history.current.index = -1; setMenuDismissed(false);
      } else setNotice("Not sent. Your draft is preserved.");
    } catch (err) { setNotice(`Not sent: ${getErrorMessage(err)}. Draft preserved.`); }
    finally { submitting.current = false; }
  };
  useInput((input, key) => {
    if (handleCtrlC && key.ctrl && (input === "c" || input === "\x03")) {
      if (isBusy) onCancel(); else exit(); return;
    }
    if (hidden) return;
    if (key.escape) {
      if (showMenu) { setMenuDismissed(true); return; }
      if (isBusy) onCancel(); return;
    }
    if (!active) return;
    if (input === "?" && !draft.text && onOpenHelp) { onOpenHelp(); return; }
    if (showMenu && (key.upArrow || key.downArrow)) {
      setCommandIndex(index => Math.max(0, Math.min(matches.length - 1, index + (key.upArrow ? -1 : 1)))); return;
    }
    if (key.tab) {
      if (showMenu && matches[commandIndex]) {
        const text = `/${matches[commandIndex].name} `;
        change({ text, cursor: text.length, literal: false });
      }
      return;
    }
    // Ink parses LF separately from CR; modified Enter requires terminal support.
    if (input === "\n" || (key.return && (key.shift || key.meta))) { insert("\n", false); return; }
    if (key.return) { void submit(); return; }
    if (key.ctrl && input === "l") {
      change({ ...draft, literal: !draft.literal }); setMenuDismissed(true); return;
    }
    if (key.ctrl || key.meta) return;
    if (key.upArrow || key.downArrow) {
      const before = draft.text.slice(0, draft.cursor);
      const after = draft.text.slice(draft.cursor);
      const column = before.length - before.lastIndexOf("\n") - 1;
      if (key.upArrow && before.includes("\n")) {
        const end = before.lastIndexOf("\n");
        const start = before.lastIndexOf("\n", end - 1) + 1;
        change({ ...draft, cursor: Math.min(start + column, end) }); return;
      }
      if (key.downArrow && after.includes("\n")) {
        const start = draft.cursor + after.indexOf("\n") + 1;
        const end = draft.text.indexOf("\n", start);
        change({ ...draft, cursor: Math.min(start + column, end < 0 ? draft.text.length : end) }); return;
      }
      if (!sentHistory.length) return;
      if (key.upArrow) {
        if (history.current.index < 0) history.current = { index: sentHistory.length, original: draft };
        history.current.index = Math.max(0, history.current.index - 1);
      } else {
        if (history.current.index < 0) return;
        history.current.index++;
      }
      if (history.current.index >= sentHistory.length) {
        change(history.current.original); history.current.index = -1;
      } else {
        const text = sentHistory[history.current.index];
        change({ text, cursor: text.length, literal: false });
      }
      return;
    }
    const positions = boundaries(draft.text);
    const previous = positions.filter(position => position < draft.cursor).pop() ?? 0;
    const next = positions.find(position => position > draft.cursor) ?? draft.text.length;
    if (key.leftArrow) { change({ ...draft, cursor: previous }); return; }
    if (key.rightArrow) { change({ ...draft, cursor: next }); return; }
    if (key.home) { change({ ...draft, cursor: draft.cursor === 0 ? 0 : draft.text.lastIndexOf("\n", draft.cursor - 1) + 1 }); return; }
    if (key.end) { const end = draft.text.indexOf("\n", draft.cursor); change({ ...draft, cursor: end < 0 ? draft.text.length : end }); return; }
    if (key.delete) { change({ ...draft, text: draft.text.slice(0, draft.cursor) + draft.text.slice(next) }); return; }
    if (key.backspace) {
      change({ ...draft, text: draft.text.slice(0, previous) + draft.text.slice(draft.cursor), cursor: previous }); return;
    }
    if (key.pageUp || key.pageDown) return;
    if (input) insert(input, input.length > 1 && /[\r\n]/.test(input));
  }, { isActive: !hidden });
  const lines = draft.text.split("\n");
  const cursorRow = draft.text.slice(0, draft.cursor).split("\n").length - 1;
  const start = Math.max(0, cursorRow - COMPOSER_MAX_ROWS + 1);
  const visible = lines.slice(start, start + COMPOSER_MAX_ROWS);
  let consumed = lines.slice(0, start).reduce((sum, line) => sum + line.length + 1, 0);
  const width = Math.max(1, (stdout?.columns ?? 80) - 4);
  return <Box display={hidden ? "none" : "flex"} flexDirection="column" flexShrink={0}>
    {showMenu && <CommandPalette compact query={query} highlight={commandIndex} mru={mruCommands} />}
    {notice && <Text color={theme.colors.warning} wrap="truncate-end">{notice}</Text>}
    {draft.literal && draft.text.startsWith("/") && <Text color={theme.colors.textSecondary}>Literal message · Ctrl+L toggles command parsing</Text>}
    <Text color={active ? theme.colors.borderFocus : theme.colors.separator}>{sectionRule(theme.typography.sectionDivider, Math.floor(Math.max(1, (stdout?.columns ?? 80) - 2) / Math.max(1, displayWidth(Array.from(theme.typography.sectionDivider)[0] ?? "-"))))}</Text>
    {visible.map((line, index) => {
      const cursor = draft.cursor - consumed;
      consumed += line.length + 1;
      const here = active && cursor >= 0 && cursor <= line.length;
      const left = [...graphemes.segment(line.slice(0, Math.max(0, cursor)))].map(segment => segment.segment);
      while (left.length && displayWidth(left.join("")) >= width) left.shift();
      const before = left.join("");
      const current = [...graphemes.segment(line.slice(Math.max(0, cursor)))][0]?.segment ?? " ";
      const after = curtailToCells(line.slice(Math.max(0, cursor) + current.length), Math.max(0, width - displayWidth(before) - displayWidth(current)));
      return <Box key={start + index}><Text color={theme.colors.brand}>{index === 0 ? "› " : "  "}</Text>
        <Text color={theme.colors.textPrimary} wrap="truncate-end">{!draft.text ? <><Text color={theme.colors.brand}>█</Text>{isBusy ? "Enter to queue a message" : !active ? "transcript focused — Tab to type" : "Type a message, / for commands"}</> : here ? <>{before}<Text inverse>{current}</Text>{after}</> : curtailToCells(line, width)}</Text>
      </Box>;
    })}
    {lines.length > COMPOSER_MAX_ROWS && <Text color={theme.colors.textSecondary}>Draft lines {start + 1}–{start + visible.length} of {lines.length}</Text>}
  </Box>;
}
