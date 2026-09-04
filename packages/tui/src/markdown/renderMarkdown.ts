/**
 * Phase 8 (C2): a deliberately bounded markdown parser — pure, no React, no deps.
 * Block kinds: heading, text, list, quote, code (fences), hr.
 * Inline on text blocks: **bold**, *italic*, `code`, ***both***.
 *
 * NOT supported this cycle (by design): links, images, tables, strikethrough,
 * HTML interpretation, setext headings, complex nesting. Code fences pass
 * through raw; MarkdownView applies the existing cli-highlight second pass.
 */

export type MarkdownSpan = { text: string; bold?: boolean; italic?: boolean; code?: boolean };

export type MarkdownBlock =
  | { kind: "heading"; level: number; spans: MarkdownSpan[] }
  | { kind: "text"; spans: MarkdownSpan[] }
  | { kind: "list"; spans: MarkdownSpan[] }
  | { kind: "quote"; spans: MarkdownSpan[]; depth: number }
  | { kind: "code"; language: string; code: string }
  | { kind: "hr" };

const INLINE_RE = /(\*\*\*([^*]+)\*\*\*|\*\*([^*]+)\*\*|`([^`]+)`|\*([^*\n]+)\*)/g;
const FENCE_RE = /^```(\w*)\s*$/;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const HR_RE = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;
const QUOTE_RE = /^((?:>\s?)+)(.*)$/;
const LIST_RE = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/;

export function parseInline(text: string): MarkdownSpan[] {
  const spans: MarkdownSpan[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) spans.push({ text: text.slice(last, idx) });
    const whole = m[0];
    if (whole.startsWith("***")) spans.push({ text: m[2], bold: true, italic: true });
    else if (whole.startsWith("**")) spans.push({ text: m[3], bold: true });
    else if (whole.startsWith("`")) spans.push({ text: m[4], code: true });
    else spans.push({ text: m[5], italic: true });
    last = idx + whole.length;
  }
  if (last < text.length) spans.push({ text: text.slice(last) });
  if (spans.length === 0) spans.push({ text });
  return spans;
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

    if (LIST_RE.test(line)) {
      flushPara();
      while (i < lines.length) {
        const item = lines[i].match(LIST_RE);
        if (!item) break;
        blocks.push({ kind: "list", spans: parseInline(item[1]) });
        i += 1;
      }
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
  return blocks;
}