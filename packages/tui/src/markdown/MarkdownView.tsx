import { Box, Text, useStdout } from "ink";
import { MarkdownBlock, MarkdownSpan, parseMarkdownText } from "./renderMarkdown.js";
import { highlightCodeBlocks } from "./highlightCodeBlocks.js";
import { useTheme } from "../theme/theme.js";
import { curtail } from "../util/format.js";

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
        .join(" | "),
      maxLen
    );
  return (
    <>
      <Text bold wrap="wrap">{line(headers)}</Text>
      <Text dimColor>{curtail(widths.map((w) => "-".repeat(w)).join("-+-"), maxLen)}</Text>
      {rows.map((row, i) => (
        <Text key={i} wrap="wrap">{line(row)}</Text>
      ))}
    </>
  );
}

/**
 * Renders parsed markdown blocks. Code blocks reuse the existing second-pass
 * highlighter (fences only) — markdown parsing runs FIRST, so highlighted ANSI
 * is never re-parsed as inline markdown.
 */
export function MarkdownView({ blocks }: { blocks: MarkdownBlock[] }) {
  const theme = useTheme();
  const { stdout } = useStdout();
  const maxCodeLen = Math.max(20, (stdout?.columns ?? 80) - 6);
  return (
    <Box flexDirection="column">
      {blocks.map((block, i) => {
        switch (block.kind) {
          case "heading":
            return (
              <Text key={i} bold color={theme.colors.primary}>
                {"  ".repeat(Math.min(block.level, 4))}
                <Spans spans={block.spans} />
              </Text>
            );
          case "text":
            return (
              <Text key={i}>
                <Spans spans={block.spans} />
              </Text>
            );
          case "list":
            return (
              <Text key={i}>
                {"  ".repeat(Math.min(block.depth, 4))}{"  • "}
                <Spans spans={block.spans} />
              </Text>
            );
          case "quote":
            return (
              <Text key={i} dimColor>
                {"▍".repeat(Math.min(block.depth, 3))} <Spans spans={block.spans} />
              </Text>
            );
          case "hr":
            return (
              <Text key={i} dimColor>
                {"─".repeat(40)}
              </Text>
            );
          case "table":
            return (
              <Box key={i} flexDirection="column">
                <TableView headers={block.headers} rows={block.rows} />
              </Box>
            );
          case "links":
            return (
              <Box key={i} flexDirection="column">
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
            const safeCode = block.code
              .split("\n")
              .map((l) => curtail(l, maxCodeLen))
              .join("\n");
            const fenced = `\`\`\`${block.language}\n${safeCode}\`\`\``;
            return (
              <Text key={i} color={theme.colors.userText} wrap="wrap">
                {highlightCodeBlocks(fenced)}
              </Text>
            );
          }
        }
      })}
    </Box>
  );
}

export { parseMarkdownText }; // convenience for callers/tests