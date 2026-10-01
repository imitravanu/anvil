import type { MarkdownSpan } from "../markdown/renderMarkdown.js";
import { displayWidth, splitByDisplayWidth } from "./format.js";

/**
 * Word-wrap styled spans to a terminal-CELL width, carrying each word's
 * styling. Ink's own <Text> wrap returns continuation lines to column 0, which
 * reads as broken formatting for list items; callers use this to render a
 * hanging indent instead (first line prefixed with the marker, continuations
 * padded to the same column).
 *
 * F5 (AUDIT-2026-09-30): the budget is cells, not code points — a CJK/emoji row
 * counted as fitting but rendered past the frame edge (matching the transcript
 * estimator, which now measures the same way).
 */

export interface SpanRow {
  spans: MarkdownSpan[];
}

export function wrapSpans(spans: MarkdownSpan[], width: number): SpanRow[] {
  if (width < 1) width = 1;
  const rows: SpanRow[] = [];
  let row: MarkdownSpan[] = [];
  let rowLen = 0;
  let pendingSpace = false;

  const pushWord = (word: string, style: MarkdownSpan, glue = false) => {
    const wordLen = displayWidth(word);
    const sep = glue ? 0 : pendingSpace && rowLen > 0 ? 1 : 0;
    if (rowLen > 0 && rowLen + sep + wordLen > width) {
      rows.push({ spans: row });
      row = [];
      rowLen = 0;
    } else if (sep === 1) {
      row.push({ text: " " });
      rowLen += 1;
    }
    row.push({ text: word, ...styleOf(style) });
    rowLen += wordLen;
    pendingSpace = !glue;
  };

  for (const span of spans) {
    const words = span.text.split(/(\s+)/).filter((w) => w !== "" && !/^\s+$/.test(w));
    for (let w = 0; w < words.length; w++) {
      const word = words[w];
      if (displayWidth(word) > width) {
        // Single word longer than the line: hard-split by CELLS, chunks glue
        // together so the split never inserts a space.
        const chunks = splitByDisplayWidth(word, width);
        pushWord(chunks[0], span);
        for (let c = 1; c < chunks.length; c++) pushWord(chunks[c], span, true);
      } else {
        pushWord(word, span);
      }
    }
  }
  if (row.length > 0) rows.push({ spans: row });
  return rows.length > 0 ? rows : [{ spans: [] }];
}

function styleOf(s: MarkdownSpan): Partial<MarkdownSpan> {
  const style: Partial<MarkdownSpan> = {};
  if (s.bold) style.bold = true;
  if (s.italic) style.italic = true;
  if (s.code) style.code = true;
  if (s.strike) style.strike = true;
  if (s.link) style.link = s.link;
  return style;
}
