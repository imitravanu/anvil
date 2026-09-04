import { Box, Text } from "ink";
import { MarkdownBlock, MarkdownSpan, parseMarkdownText } from "./renderMarkdown.js";
import { highlightCodeBlocks } from "./highlightCodeBlocks.js";
import { useTheme } from "../theme/theme.js";

function Spans({ spans }: { spans: MarkdownSpan[] }) {
  const theme = useTheme();
  return (
    <>
      {spans.map((s, i) => (
        <Text key={i} bold={s.bold} italic={s.italic} color={s.code ? theme.colors.toolName : undefined}>
          {s.text}
        </Text>
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
                {"  • "}
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