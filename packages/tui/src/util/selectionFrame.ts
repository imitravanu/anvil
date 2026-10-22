import { measureElement, type DOMElement } from "ink";
import wrapAnsi from "wrap-ansi";
import cliTruncate from "cli-truncate";
import stringWidth from "string-width";
import { sanitizeTerminalText } from "./sanitize.js";
import { SELECTION_MAX_CELLS } from "./displayLimits.js";

type Cell = { text: string; x: number; width: number };
export type SelectionPoint = { x: number; y: number };
export type SelectionFrame = { x: number; y: number; width: number; height: number; rows: Array<Array<Cell | null>> };
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Snapshot laid-out text, not model source: wrapping and clipping match Ink 7. */
export function selectionFrame(root: DOMElement): SelectionFrame | null {
  const bounds = measureElement(root);
  const width = Math.floor(bounds.width); const height = Math.floor(bounds.height);
  if (width < 1 || height < 1 || width * height > SELECTION_MAX_CELLS) return null;
  const frame: SelectionFrame = { ...bounds, width, height, rows: Array.from({ length: height }, () => Array<Cell | null>(width).fill(null)) };
  const textOf = (node: DOMElement): string => node.childNodes.map(child => child.nodeName === "#text" ? child.nodeValue : textOf(child)).join("");
  const visit = (node: DOMElement, clip: { left: number; top: number; right: number; bottom: number }) => {
    if (node.style.display === "none") return;
    const rect = measureElement(node);
    const next = { ...clip };
    if (node.style.overflow === "hidden" || node.style.overflowX === "hidden") { next.left = Math.max(next.left, rect.x); next.right = Math.min(next.right, rect.x + rect.width); }
    if (node.style.overflow === "hidden" || node.style.overflowY === "hidden") { next.top = Math.max(next.top, rect.y); next.bottom = Math.min(next.bottom, rect.y + rect.height); }
    if (node.nodeName === "ink-text") {
      const raw = sanitizeTerminalText(textOf(node));
      const maxWidth = Math.max(1, Math.floor(rect.width));
      const mode = node.style.textWrap ?? "wrap";
      const overflows = raw.split("\n").some(line => stringWidth(line) > maxWidth);
      const text = !overflows ? raw : mode.startsWith("truncate") ? cliTruncate(raw, maxWidth, { position: mode === "truncate-middle" ? "middle" : mode === "truncate-start" ? "start" : "end" }) : wrapAnsi(raw, maxWidth, { trim: false, hard: true, wordWrap: mode !== "hard" });
      text.split("\n").forEach((line, index) => {
        const y = rect.y + index;
        if (y < next.top || y >= next.bottom) return;
        let x = rect.x;
        for (const { segment } of graphemes.segment(line)) {
          const cells = stringWidth(segment);
          if (cells > 0 && x >= next.left && x + cells <= next.right) {
            const column = Math.floor(x - frame.x);
            const cell = { text: segment, x: column, width: cells };
            for (let offset = 0; offset < cells; offset++) frame.rows[Math.floor(y - frame.y)][column + offset] = cell;
          }
          x += cells;
        }
      });
    } else for (const child of node.childNodes) if (child.nodeName !== "#text") visit(child, next);
  };
  visit(root, { left: bounds.x, top: bounds.y, right: bounds.x + width, bottom: bounds.y + height });
  return frame;
}

export function selectionRow(frame: SelectionFrame, y: number, from = 0, to = frame.width): string {
  let previous: Cell | null = null;
  return frame.rows[y].slice(from, to).map(cell => {
    if (!cell) { previous = null; return " "; }
    if (cell === previous) return "";
    previous = cell; return cell.text;
  }).join("");
}

export function selectionRange(frame: SelectionFrame, start: SelectionPoint, end: SelectionPoint, y: number): [number, number] {
  const [first, last] = start.y < end.y || start.y === end.y && start.x <= end.x ? [start, end] : [end, start];
  if (y < first.y || y > last.y) return [0, 0];
  let from = y === first.y ? first.x : 0;
  let to = y === last.y ? last.x + 1 : frame.width;
  from = frame.rows[y][from]?.x ?? from;
  const tail = frame.rows[y][to - 1];
  if (tail) to = tail.x + tail.width;
  return [from, to];
}
