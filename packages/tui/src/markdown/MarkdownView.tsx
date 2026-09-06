import { Box, Text, useStdout } from "ink";
import { MarkdownBlock, MarkdownSpan, parseMarkdownText } from "./renderMarkdown.js";
import { highlightCodeBlocks } from "./highlightCodeBlocks.js";
import { useTheme } from "../theme/theme.js";
import { curtail } from "../util/format.js";
import { wrapSpans } from "../util/wrapSpans.js";
import {
  CODE_HEAD_LINES,
  CODE_TAIL_LINES,
  markdownBlockSpaced,
} from "../util/displayLimits.js";

function Spans({ spans }: { spans: MarkdownSpan[] }) {
  const theme = useTheme();
  return (
    <>
      {spans.map((s, i) => (
        <Text
          key={i}
          bold={s.bold}
          italic={s.italic}
          dimColor={s.strike ? true : undefined}
          color={s.code ? theme.colors.toolName : undefined}
        >
          {s.text}
          {s.linkN != null && <Text dimColor> [{s.linkN}]</Text>}
        </Text>
      ))}
    </>
  );
}

/** Code-point-aware width (never String#length — CJK/emoji safety). */
function cellWidth(text: string): number {
  return Array.from(text).length;
}

function plainText(spans: MarkdownSpan[]): string {
  return spans.map((s) => s.text).join("");
}

function TableView({ headers, rows }: { headers: MarkdownSpan[][]; rows: MarkdownSpan[][][] }) {
  const { stdout } = useStdout();
  const maxLen = Math.max(20, (stdout?.columns ?? 80) - 6);
  const colCount = Math.max(headers.length, ...rows.map((r) => r.length));
  const widths: number[] = [];
  for (let c = 0; c < colCount; c++) {
    const cells = [
      headers[c] ? [headers[c]] : [],
      ...rows.map((r) => (r[c] ? [r[c]] : [])),
    ].flat();
    widths.push(Math.max(1, ...cells.map((spans) => cellWidth(plainText(spans)))));
  }
  const pad = (spans: MarkdownSpan[], w: number) => {
    const text = plainText(spans);
    return text + " ".repeat(Math.max(0, w - cellWidth(text)));
  };
  // NOTE: padded table cells intentionally drop inline styling — alignment
  // needs plain strings, and footnotes still resolve via the links block.
  // Wide model-emitted tables overflowed narrow terminals and stacked rows;
  // curtail the finished line so a table can never exceed terminal width.
  const line = (cells: MarkdownSpan[][]) =>
    curtail(
      cells
        .map((_, c) => pad(cells[c] ?? [{ text: "" }], widths[c]))
        .join(" │ "),
      maxLen
    );
  const rule = curtail(
    widths.map((w) => "─".repeat(w)).join("─┼─"),
    maxLen
  );
  return (
    <>
      <Text bold>{line(headers)}</Text>
      <Text dimColor>{rule}</Text>
      {rows.map((row, i) => (
        <Text key={i}>{line(row)}</Text>
      ))}
    </>
  );
}

/**
 * Render parsed markdown blocks. Code blocks reuse the existing second-pass
 * highlighter (fences only) — markdown parsing runs FIRST, so highlighted ANSI
 * is never re-parsed as inline markdown. Long code blocks window head+tail so
 * one block can never eat the whole transcript; the full text stays in the
 * session file.
 */
export function MarkdownView({ blocks }: { blocks: MarkdownBlock[] }) {
  const theme = useTheme();
  const { stdout } = useStdout();
  const maxCodeLen = Math.max(20, (stdout?.columns ?? 80) - 6);
  // Wrap width mirrors the transcript estimator's usable width (padding +
  // frame reserve); list continuation lines hang-indent to the marker column.
  const wrapWidth = Math.max(20, (stdout?.columns ?? 80) - 6);
  return (
    <Box flexDirection="column">
      {blocks.map((block, i) => {
        const spaced = markdownBlockSpaced(block.kind, blocks[i - 1]?.kind);
        return (
          // flexDirection column: Box defaults to row, which laid the
          // table's rule/rows out side by side on one physical line.
          <Box key={i} flexDirection="column" marginTop={spaced ? 1 : 0}>
            {renderBlock(block, theme, maxCodeLen, wrapWidth)}
          </Box>
        );
      })}
    </Box>
  );
}

function renderBlock(
  block: MarkdownBlock,
  theme: ReturnType<typeof useTheme>,
  maxCodeLen: number,
  wrapWidth: number
) {
  switch (block.kind) {
    case "heading":
      return (
        <Text bold color={theme.colors.primary}>
          {"  ".repeat(Math.min(block.level, 4))}
          <Spans spans={block.spans} />
        </Text>
      );
    case "text":
      return (
        <Text>
          <Spans spans={block.spans} />
        </Text>
      );
    case "list": {
      // Hanging indent: the marker sits in the left column and wrapped
      // continuation lines align under the text, not at column 0. The
      // prefix mirrors the exact marker width ("• " is 2 cells, "1. " 3).
      const indent = Math.min(block.depth, 4) * 2;
      const markerStr = `${block.marker} `;
      const prefix = " ".repeat(indent + markerStr.length);
      const rows = wrapSpans(block.spans, Math.max(10, wrapWidth - prefix.length));
      return (
        <Box flexDirection="column">
          <Text>
            {"  ".repeat(Math.min(block.depth, 4))}
            {markerStr}
            <Spans spans={rows[0]?.spans ?? []} />
          </Text>
          {rows.slice(1).map((r, j) => (
            <Text key={j}>
              {prefix}
              <Spans spans={r.spans} />
            </Text>
          ))}
        </Box>
      );
    }
    case "quote":
      return (
        <Text dimColor>
          {"▍".repeat(Math.min(block.depth, 3))} <Spans spans={block.spans} />
        </Text>
      );
    case "hr":
      return (
        <Text dimColor>
          {"─".repeat(40)}
        </Text>
      );
    case "table":
      return <TableView headers={block.headers} rows={block.rows} />;
    case "links":
      return (
        <Box flexDirection="column">
          {block.links.map((l) => (
            <Text key={l.n} dimColor>
              [{l.n}] {l.text !== l.url ? `${l.text} → ` : ""}{l.url}
            </Text>
          ))}
        </Box>
      );
    case "code": {
      // Curtail plain code lines BEFORE highlighting: a single minified
      // line would otherwise render as 100+ visual rows and stack the
      // frame. Curtailing post-highlight would slice ANSI sequences.
      const all = block.code.split("\n").map((l) => curtail(l, maxCodeLen));
      const highlight = (lines: string[]) =>
        highlightCodeBlocks(`\`\`\`${block.language}\n${lines.join("\n")}\n\`\`\``).split("\n");
      // Window long blocks head+tail; ANSI output splits safely on \n
      // (escape sequences never contain a newline byte).
      const segs: { text: string; dim?: boolean }[] =
        all.length > CODE_HEAD_LINES + CODE_TAIL_LINES + 2
          ? [
              ...highlight(all.slice(0, CODE_HEAD_LINES)).map((text) => ({ text })),
              {
                text: `… ${all.length - CODE_HEAD_LINES - CODE_TAIL_LINES} lines omitted (${all.length} total — full block in the session file)`,
                dim: true,
              },
              ...highlight(all.slice(-CODE_TAIL_LINES)).map((text) => ({ text })),
            ]
          : highlight(all).map((text) => ({ text }));
      return (
        <Box flexDirection="column">
          {segs.map((s, j) => (
            <Text key={j}>
              <Text dimColor>▎ </Text>
              <Text dimColor={s.dim || undefined}>{s.text}</Text>
            </Text>
          ))}
        </Box>
      );
    }
  }
}

export { parseMarkdownText }; // convenience for callers/tests
