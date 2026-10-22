import { useState } from "react";
import { Text, useStdout } from "ink";
import { useInput, usePaste } from "../hooks/useUIInput.js";
import { OverlayFrame } from "./OverlayFrame.js";
import { useTheme } from "../theme/theme.js";
import { sanitizeTerminalText } from "../util/sanitize.js";
import { windowOffset } from "../hooks/useWindowedList.js";
import { TextDetail } from "./TextDetail.js";

export function QueuePicker({ items, held, onRemove, onResume, onClose, title = "Message queue" }: {
  title?: string;
  items: { id: string; text: string }[]; held: boolean;
  onRemove: (id: string) => void;
  onResume: () => void; onClose: () => void;
}) {
  const theme = useTheme();
  const { stdout } = useStdout();
  const [selected, setSelected] = useState(0);
  const [detail, setDetail] = useState<string | null>(null);
  const index = Math.min(selected, Math.max(0, items.length - 1));
  const budget = Math.max(1, (stdout?.rows ?? 24) - 10);
  const { offset } = windowOffset(items.length, index, budget);
  usePaste(() => { /* intentional: pasted shortcuts must never mutate queued intent. */ });
  useInput((input, key) => {
    if (detail !== null) return;
    if (key.ctrl || key.meta) return;
    if (key.escape) onClose();
    else if (key.upArrow) setSelected(Math.max(0, index - 1));
    else if (key.downArrow) setSelected(Math.min(items.length - 1, index + 1));
    else if (input === "d" && items[index] !== undefined) onRemove(items[index].id);
    else if (input === "r" && held) onResume();
    else if (key.return && items[index]) setDetail(items[index].text);
  });
  if (detail !== null) return <TextDetail title={title} text={detail} onClose={() => setDetail(null)} />;
  return <OverlayFrame minimal title={title} meta={held ? "held" : "pending"} hints="↑/↓ select · Enter inspect · d remove · r resume held · Esc close">
    {!items.length && <Text color={theme.colors.textSecondary}>No queued messages.</Text>}
    {items.slice(offset, offset + budget).map((item, local) => <Text key={item.id} color={local + offset === index ? theme.colors.textPrimary : theme.colors.textSecondary} wrap="truncate-end">{local + offset === index ? "› " : "  "}{sanitizeTerminalText(item.text).replace(/\n/g, " ↵ ")}</Text>)}
  </OverlayFrame>;
}
