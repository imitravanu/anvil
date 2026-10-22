import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Box, Text, measureElement, useStderr, useStdout, type DOMElement } from "ink";
import { usePointer } from "../hooks/useUIInput.js";
import { selectionFrame, selectionRange, selectionRow, type SelectionFrame, type SelectionPoint } from "../util/selectionFrame.js";
import { copySelection } from "../util/clipboard.js";
import { useTheme } from "../theme/theme.js";

type Selection = { frame: SelectionFrame; start: SelectionPoint; end: SelectionPoint; dragging: boolean };

/** Freeze only the visible region during selection; live content keeps updating behind it. */
export function SelectableRegion({ children, enabled = true, resetKey, onNotice }: {
  children: ReactNode; enabled?: boolean; resetKey?: unknown; onNotice?: (notice: string | null) => void;
}) {
  const root = useRef<DOMElement>(null);
  const theme = useTheme();
  const { stderr } = useStderr();
  const { stdout } = useStdout();
  const [selection, setSelection] = useState<Selection | null>(null);
  const current = useRef<Selection | null>(null);
  const generation = useRef(0);
  const copying = useRef(false);
  const pending = useRef<{ text: string; id: number } | null>(null);
  const update = (value: Selection | null) => { current.current = value; setSelection(value); };
  const clear = () => { generation.current++; update(null); onNotice?.(null); };
  useEffect(() => { clear(); }, [enabled, resetKey, stdout.columns, stdout.rows]);
  useEffect(() => () => { generation.current++; pending.current = null; }, []);
  useLayoutEffect(() => {
    if (!current.current || !root.current) return;
    const bounds = measureElement(root.current);
    const frame = current.current.frame;
    if (bounds.x !== frame.x || bounds.y !== frame.y || Math.floor(bounds.width) !== frame.width || Math.floor(bounds.height) !== frame.height) clear();
  });
  const enqueueCopy = (text: string, id: number) => {
    pending.current = { text, id };
    if (copying.current) return;
    copying.current = true;
    void (async () => {
      while (pending.current) {
        const job = pending.current; pending.current = null;
        try {
          const result = await copySelection(job.text, stderr);
          if (job.id === generation.current) onNotice?.(result.ok ? result.confirmed ? "Copied selection" : "Copy sent to terminal" : result.reason === "too-large" ? "Selection too large to copy" : "Clipboard unavailable");
        } catch {
          // A clipboard helper failure must not interrupt a conversation.
          if (job.id === generation.current) onNotice?.("Clipboard unavailable");
        }
      }
      copying.current = false;
    })();
  };
  usePointer(event => {
    if (!event || event.direction) { if (current.current) clear(); return; }
    if (!event.pointer || event.x === undefined || event.y === undefined || !root.current) return;
    if (event.pointer === "press") {
      const frame = current.current?.frame ?? selectionFrame(root.current);
      if (!frame || event.x < frame.x || event.x >= frame.x + frame.width || event.y < frame.y || event.y >= frame.y + frame.height) { clear(); return; }
      generation.current++; onNotice?.(null);
      const point = { x: Math.floor(event.x - frame.x), y: Math.floor(event.y - frame.y) };
      update({ frame, start: point, end: point, dragging: true });
      return;
    }
    const active = current.current;
    if (!active?.dragging) return;
    const end = { x: Math.max(0, Math.min(active.frame.width - 1, Math.floor(event.x - active.frame.x))), y: Math.max(0, Math.min(active.frame.height - 1, Math.floor(event.y - active.frame.y))) };
    const next = { ...active, end, dragging: event.pointer !== "release" };
    update(next);
    if (event.pointer !== "release") return;
    if (end.x === active.start.x && end.y === active.start.y) { clear(); return; }
    const text = active.frame.rows.map((_, y) => {
      const [from, to] = selectionRange(active.frame, active.start, end, y);
      return to > from ? selectionRow(active.frame, y, from, to).trimEnd() : null;
    }).filter(line => line !== null).join("\n");
    if (!text.trim()) { clear(); return; }
    enqueueCopy(text, ++generation.current);
  }, enabled);
  return <Box ref={root} flexDirection="column" flexGrow={1} minHeight={0} overflow="hidden">
    {children}
    {selection && <Box position="absolute" top={0} left={0} width={selection.frame.width} height={selection.frame.height} flexDirection="column">
      {selection.frame.rows.map((_, y) => {
        const [from, to] = selectionRange(selection.frame, selection.start, selection.end, y);
        return <Text key={y} color={theme.colors.textPrimary} wrap="truncate-end">{selectionRow(selection.frame, y, 0, from)}<Text inverse={to > from}>{selectionRow(selection.frame, y, from, to)}</Text>{selectionRow(selection.frame, y, to)}</Text>;
      })}
    </Box>}
  </Box>;
}
