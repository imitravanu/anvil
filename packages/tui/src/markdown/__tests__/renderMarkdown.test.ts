import { describe, expect, it } from "vitest";
import { parseInline, parseMarkdownText } from "../renderMarkdown.js";

describe("bounded markdown renderer", () => {
  it("parses headings with a level", () => {
    const blocks = parseMarkdownText("# Big\n\n## Small");
    expect(blocks[0]).toMatchObject({ kind: "heading", level: 1 });
    expect(blocks[1]).toMatchObject({ kind: "heading", level: 2 });
  });

  it("parses inline bold, italic, code, and both", () => {
    const spans = parseInline("a **bold** and *it* and `code` and ***both***");
    expect(spans.map((s) => ({ ...s }))).toEqual([
      { text: "a " },
      { text: "bold", bold: true },
      { text: " and " },
      { text: "it", italic: true },
      { text: " and " },
      { text: "code", code: true },
      { text: " and " },
      { text: "both", bold: true, italic: true },
    ]);
  });

  it("passes fenced code blocks through raw with the language", () => {
    const blocks = parseMarkdownText("before\n```ts\nconst x: number = 1;\n```\nafter");
    expect(blocks.map((b) => b.kind)).toEqual(["text", "code", "text"]);
    const code = blocks.find((b) => b.kind === "code");
    expect(code).toMatchObject({ language: "ts", code: "const x: number = 1;" });
    // fences content is NOT inline-parsed
    expect((blocks[0] as any).spans[0].text).toBe("before");

    const cppBlocks = parseMarkdownText("```c++\nint x = 1;\n```");
    expect(cppBlocks[0]).toMatchObject({ kind: "code", language: "c++", code: "int x = 1;" });
  });

  it("parses lists, quotes, and hr", () => {
    const blocks = parseMarkdownText("- one\n- two\n\n> a quote\n\n---");
    expect(blocks.map((b) => b.kind)).toEqual(["list", "list", "quote", "hr"]);
    expect((blocks[2] as any).depth).toBe(1);
  });

  it("keeps unsupported markdown visible (links are literal text, never interpreted)", () => {
    const blocks = parseMarkdownText("see [a link](https://example.com) here");
    expect((blocks[0] as any).spans[0].text).toBe("see [a link](https://example.com) here");
  });

  it("groups plain paragraphs into a single text block", () => {
    const blocks = parseMarkdownText("line one\nline two");
    expect(blocks.length).toBe(1);
    expect(blocks[0]).toMatchObject({ kind: "text" });
  });
});