import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Box, measureElement, type DOMElement } from "ink";

/** Real rendered rows, shared by transcript and detail views. */
export function ScrollViewport({ children, offset, onBounds }: {
  children: ReactNode; offset: number; onBounds?: (maximum: number) => void;
}) {
  const viewport = useRef<DOMElement>(null);
  const content = useRef<DOMElement>(null);
  const [maximum, setMaximum] = useState(0);
  const previous = useRef(-1);
  useLayoutEffect(() => {
    if (!viewport.current || !content.current) return;
    const height = measureElement(viewport.current).height;
    if (height <= 0) return;
    const next = Math.max(0, measureElement(content.current).height - height);
    if (next !== previous.current) {
      previous.current = next; setMaximum(next); onBounds?.(next);
    }
  });
  return <Box ref={viewport} flexDirection="column" flexGrow={1} flexShrink={1} minHeight={0} overflow="hidden">
    <Box ref={content} position="absolute" top={offset === Number.MAX_SAFE_INTEGER ? 0 : undefined} bottom={offset === Number.MAX_SAFE_INTEGER ? undefined : -Math.min(Math.max(0, offset), maximum)} width="100%" flexDirection="column" flexShrink={0}>
      {children}
    </Box>
  </Box>;
}
