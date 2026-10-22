import { useLayoutEffect, useRef, useState } from "react";
import { Box, measureElement, useStdout, type DOMElement } from "ink";
import type { DisplayMessage } from "../hooks/eventReducer.js";
import { estimatedLines } from "../util/transcriptWindow.js";
import { MessageView } from "./MessageView.js";
import { ScrollViewport } from "./ScrollViewport.js";

type Measurement = { width: number; expanded: boolean; first: boolean; rows: number };
type Anchor = { id: string; row: number };

/** Virtualize messages, but keep an individual tall answer row-scrollable. */
export function TranscriptViewport({ messages, expanded, offset, onBounds }: {
  messages: readonly DisplayMessage[]; expanded: boolean; offset: number;
  onBounds?: (maximum: number, anchoredOffset: number) => void;
}) {
  const { stdout } = useStdout();
  const width = Math.max(1, (stdout?.columns ?? 80) - 2);
  const viewport = useRef<DOMElement>(null);
  const nodes = useRef(new Map<string, DOMElement>());
  const measurements = useRef(new WeakMap<DisplayMessage, Measurement>());
  const anchor = useRef<Anchor | null>(null);
  const expectedOffset = useRef(0);
  const reported = useRef({ maximum: -1, offset: -1 });
  const [height, setHeight] = useState(Math.max(1, (stdout?.rows ?? 24) - 7));
  const [, invalidate] = useState(0);
  const heights = messages.map((message, index) => {
    const cached = measurements.current.get(message);
    if (cached?.width === width && cached.expanded === expanded && cached.first === (index === 0)) return cached.rows;
    const rows = Math.max(1, estimatedLines(message, width + 2, expanded) - (index === 0 ? 1 : 0));
    measurements.current.set(message, { width, expanded, first: index === 0, rows });
    return rows;
  });
  const prefixes = [0];
  for (const rows of heights) prefixes.push(prefixes[prefixes.length - 1] + rows);
  const total = prefixes[prefixes.length - 1];
  const top = Math.max(0, total - height - offset);
  let first = 0;
  while (first < messages.length - 1 && prefixes[first + 1] <= top) first++;
  if (offset === 0) anchor.current = null;
  else if (offset !== expectedOffset.current || !anchor.current) {
    anchor.current = { id: messages[first].id, row: Math.max(0, top - prefixes[first]) };
  }
  expectedOffset.current = offset;
  let last = first;
  while (last < messages.length && prefixes[last] < top + height) last++;
  // A viewport of buffer on each side avoids mount churn on single-row scrolls.
  let start = first;
  while (start > 0 && prefixes[first] - prefixes[start] < height) start--;
  let end = last;
  while (end < messages.length && prefixes[end] - prefixes[last] < height) end++;

  useLayoutEffect(() => {
    if (!viewport.current) return;
    const actualHeight = measureElement(viewport.current).height;
    if (actualHeight <= 0) return;
    if (actualHeight !== height) setHeight(actualHeight);
    let changed = false;
    const corrected = [...heights];
    for (let index = start; index < end; index++) {
      const node = nodes.current.get(messages[index].id);
      if (!node) continue;
      const rows = Math.max(1, measureElement(node).height + (index > 0 ? 1 : 0));
      if (rows !== corrected[index]) {
        changed = true; corrected[index] = rows;
        measurements.current.set(messages[index], { width, expanded, first: index === 0, rows });
      }
    }
    const correctedTotal = corrected.reduce((sum, rows) => sum + rows, 0);
    const maximum = Math.max(0, correctedTotal - actualHeight);
    let anchoredOffset = 0;
    if (offset > 0 && anchor.current) {
      const index = messages.findIndex(message => message.id === anchor.current?.id);
      const before = index >= 0 ? corrected.slice(0, index).reduce((sum, rows) => sum + rows, 0) : 0;
      anchoredOffset = Math.max(0, Math.min(maximum, correctedTotal - actualHeight - before - (index >= 0 ? anchor.current.row : 0)));
    }
    expectedOffset.current = anchoredOffset;
    if (reported.current.maximum !== maximum || reported.current.offset !== anchoredOffset) {
      reported.current = { maximum, offset: anchoredOffset };
      onBounds?.(maximum, anchoredOffset);
    }
    if (changed) invalidate(value => value + 1);
  });
  return <Box ref={viewport} flexDirection="column" flexGrow={1} minHeight={0} overflow="hidden">
    <ScrollViewport offset={offset}>
      {start > 0 && <Box height={prefixes[start]} flexShrink={0} />}
      {messages.slice(start, end).map((message, local) => <Box key={message.id} ref={node => { if (node) nodes.current.set(message.id, node); else nodes.current.delete(message.id); }} marginTop={start + local > 0 ? 1 : 0} flexShrink={0}>
        <MessageView message={message} expandTools={expanded} minimal />
      </Box>)}
      {end < messages.length && <Box height={total - prefixes[end]} flexShrink={0} />}
    </ScrollViewport>
  </Box>;
}
