/**
 * Bounded markdown parser — pure, no React, no deps. Round 2  adds links
 * (safe: text + footnotes, never clickable), nested lists (depth), tables,
 * and strikethrough on top of the round-1 set (headings, text, lists,
 * quotes, code fences, hr with **bold** / *italic* / `code` / ***both***).
 *
 * Still NOT supported (by design): images (rendered as their alt text when
 * written `![alt](url)`, never fetched), HTML (escaped to visible text),
 * setext headings, complex nesting. Code fences pass through raw;
 * MarkdownView applies the existing cli-highlight second pass.
 */

export type MarkdownSpan = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  strike?: boolean;
  /** Link target URL; footnote number assigned in a post-pass (linkN). */
  link?: string;
  linkN?: number;
};

export type MarkdownBlock =
  | { kind: "heading"; level: number; spans: MarkdownSpan[] }
  | { kind: "text"; spans: MarkdownSpan[] }
  | { kind: "list"; depth: number; spans: MarkdownSpan[] }
  | { kind: "quote"; spans: MarkdownSpan[]; depth: number }
  | { kind: "code"; language: string; code: string }
  | { kind: "hr" }
  | { kind: "table"; headers: MarkdownSpan[][]; rows: MarkdownSpan[][][] }
  | { kind: "links"; links: { n: number; text: string; url: string }[] };

// Groups: 1 whole | 2 linkText 3 url | 4 ***  | 5 ** | 6 `code` | 7 ~~strike~~ | 8 *italic*
const INLINE_RE =
  /(\[([^\]\n]+)\]\(([^)\s]+)\)|\*\*\*([^*]+)\*\*\*|\*\*([^*]+)\*\*|`([^`]+)`|~~([^~]+)~~|\*([^*\n]+)\*)/g;
const FENCE_RE = /^```([^\s`]*)\s*$/;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const HR_RE = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;
const QUOTE_RE = /^((?:>\s?)+)(.*)$/;
const LIST_RE = /^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/;

export function parseInline(text: string, allowLinks = true): MarkdownSpan[] {
  const spans: MarkdownSpan[] = [];
  const push = (span: MarkdownSpan) => {
    // Merge adjacent plain spans so footnote runs and styling stay compact.
    const prev = spans[spans.length - 1];
    if (
      prev &&
      !prev.bold && !prev.italic && !prev.code && !prev.strike && !prev.link &&
      !span.bold && !span.italic && !span.code && !span.strike && !span.link
    ) {
      prev.text += span.text;
    } else {
      spans.push(span);
    }
  };
  let last = 0;
  for (const m of text.matchAll(INLINE_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) push({ text: text.slice(last, idx) });
    if (m[2] !== undefined && allowLinks) {
      // Link: inner text keeps its inline styles; the URL rides along for
      // the footnote post-pass. Nested links are not parsed (inner call
      // runs with allowLinks=false) — outer brackets win, visibly.
      for (const s of parseInline(m[2], false)) {
        push({ ...s, link: m[3] });
      }
    } else if (m[2] !== undefined) {
      push({ text: m[0] });
    } else if (m[4] !== undefined) {
      push({ text: m[4], bold: true, italic: true });
    } else if (m[5] !== undefined) {
      push({ text: m[5], bold: true });
    } else if (m[6] !== undefined) {
      push({ text: m[6], code: true });
    } else if (m[7] !== undefined) {
      push({ text: m[7], strike: true });
    } else {
      push({ text: m[8], italic: true });
    }
    last = idx + m[0].length;
  }
  if (last < text.length) push({ text: text.slice(last) });
  if (spans.length === 0) push({ text });
  return spans;
}

/** Split a table line into trimmed cells (outer pipes optional). */
function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

function isDelimiter(line: string): boolean {
  if (!line.includes("|") && !line.includes("-")) return false;
  const cells = splitRow(line);
  return cells.length > 0 && cells.every((c) => /^:?-{1,}:?$/.test(c));
}

function parseTable(lines: string[], start: number): { headers: MarkdownSpan[][]; rows: MarkdownSpan[][][]; next: number } {
  const headers = splitRow(lines[start]).map((c) => parseInline(c));
  const rows: MarkdownSpan[][][] = [];
  let i = start + 2; // skip header + delimiter
  while (i < lines.length && lines[i].includes("|") && lines[i].trim() !== "") {
    rows.push(splitRow(lines[i]).map((c) => parseInline(c)));
    i++;
  }
  return { headers, rows, next: i };
}

function listDepth(indent: string): number {
  return Math.floor(indent.replace(/\t/g, "  ").length / 2);
}

/**
 * Assign footnote numbers to link runs (dedup by URL, first-seen order) and
 * append the footnote block. The number lands on the LAST span of each
 * same-URL run so `[*bold* + plain](url)` markers print once.
 */
function collectLinks(blocks: MarkdownBlock[]): void {
  const numbers = new Map<string, number>();
  const footnotes: { n: number; text: string; url: string }[] = [];
  const firstText = new Map<string, string>();
  const visitSpans = (spans: MarkdownSpan[]) => {
    let k = 0;
    while (k < spans.length) {
      const url = spans[k].link;
      if (!url) {
        k++;
        continue;
      }
      let end = k;
      while (end + 1 < spans.length && spans[end + 1].link === url) end++;
      if (!numbers.has(url)) {
        const n = numbers.size + 1;
        numbers.set(url, n);
        footnotes.push({ n, text: "", url });
        firstText.set(url, spans.slice(k, end + 1).map((s) => s.text).join(""));
      }
      spans[end].linkN = numbers.get(url);
      k = end + 1;
    }
  };
  for (const b of blocks) {
    if (b.kind === "text" || b.kind === "heading" || b.kind === "list" || b.kind === "quote") {
      visitSpans(b.spans);
    } else if (b.kind === "table") {
      for (const row of [b.headers, ...b.rows]) for (const cell of row) visitSpans(cell);
    }
  }
  for (const f of footnotes) f.text = firstText.get(f.url) ?? f.url;
  if (footnotes.length > 0) blocks.push({ kind: "links", links: footnotes });
}

export function parseMarkdownText(text: string): MarkdownBlock[] {
  const lines = text.split("\n");
  const blocks: MarkdownBlock[] = [];
  let para: string[] = [];
  const flushPara = () => {
    if (para.length > 0) {
      blocks.push({ kind: "text", spans: parseInline(para.join("\n")) });
      para = [];
    }
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    const fence = line.match(FENCE_RE);
    if (fence) {
      flushPara();
      const language = fence[1];
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !FENCE_RE.test(lines[i])) {
        code.push(lines[i]);
        i += 1;
      }
      i += 1; // skip closing fence
      blocks.push({ kind: "code", language, code: code.join("\n") });
      continue;
    }

    if (line.trim() === "") {
      flushPara();
      i += 1;
      continue;
    }

    const heading = line.match(HEADING_RE);
    if (heading) {
      flushPara();
      blocks.push({ kind: "heading", level: heading[1].length, spans: parseInline(heading[2].trim()) });
      i += 1;
      continue;
    }

    if (HR_RE.test(line)) {
      flushPara();
      blocks.push({ kind: "hr" });
      i += 1;
      continue;
    }

    // Table: header row + delimiter row, then body rows containing "|".
    if (
      line.includes("|") &&
      i + 1 < lines.length &&
      isDelimiter(lines[i + 1])
    ) {
      flushPara();
      const table = parseTable(lines, i);
      blocks.push({ kind: "table", headers: table.headers, rows: table.rows });
      i = table.next;
      continue;
    }

    const list = line.match(LIST_RE);
    if (list) {
      flushPara();
      const depth = listDepth(list[1]);
      blocks.push({ kind: "list", depth, spans: parseInline(list[2]) });
      i += 1;
      continue;
    }

    const quote = line.match(QUOTE_RE);
    if (quote) {
      flushPara();
      const depth = (quote[1].match(/>/g) ?? []).length;
      blocks.push({ kind: "quote", depth: Math.max(1, depth), spans: parseInline(quote[2].trim()) });
      i += 1;
      continue;
    }

    para.push(line);
    i += 1;
  }
  flushPara();
  collectLinks(blocks);
  return blocks;
}
