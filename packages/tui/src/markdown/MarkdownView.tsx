import { Box, Text } from "ink";
import { MarkdownBlock, MarkdownSpan, parseMarkdownText } from "./renderMarkdown.js";
import { highlightCodeBlocks } from "./highlightCodeBlocks.js";
import { useTheme } from "../theme/theme.js";

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
  const line = (cells: MarkdownSpan[][]) =>
    cells
      .map((_, c) => pad(cells[c] ?? [{ text: "" }], widths[c]))
      .join(" | ");
  return (
    <>
      <Text bold>{line(headers)}</Text>
      <Text dimColor>{widths.map((w) => "-".repeat(w)).join("-+-")}</Text>
      {rows.map((row, i) => (
        <Text key={i}>{line(row)}</Text>
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
            const fenced = `\`\`\`${block.language}\n${block.code}\`\`\``;
            return (
              <Text key={i} color={theme.colors.userText}>
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