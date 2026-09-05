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

  it("U8: links parse to text + footnote block (never clickable, never fetched)", () => {
    const blocks = parseMarkdownText("see [a link](https://example.com) here");
    expect(blocks.map((b) => b.kind)).toEqual(["text", "links"]);
    const text = blocks[0] as any;
    expect(text.spans.map((s: any) => s.text).join("")).toBe("see a link here");
    const linkSpan = text.spans.find((s: any) => s.link);
    expect(linkSpan).toMatchObject({ text: "a link", link: "https://example.com", linkN: 1 });
    expect(blocks[1]).toMatchObject({
      kind: "links",
      links: [{ n: 1, text: "a link", url: "https://example.com" }],
    });
  });

  it("U8: duplicate URLs share one footnote; styled link text keeps styles", () => {
    const blocks = parseMarkdownText("[**a**](https://x.test) and [a](https://x.test)");
    expect(blocks.map((b) => b.kind)).toEqual(["text", "links"]);
    expect((blocks[1] as any).links).toHaveLength(1);
    const spans = (blocks[0] as any).spans;
    // both occurrences point at the shared footnote
    expect(spans.filter((s: any) => s.linkN === 1)).toHaveLength(2);
    expect(spans.find((s: any) => s.text === "a" && s.bold)).toBeTruthy();
  });

  it("U8: nested lists carry depth", () => {
    const blocks = parseMarkdownText("- top\n  - nested\n    - deep\n1. ordered");
    expect(blocks.map((b) => b.kind)).toEqual(["list", "list", "list", "list"]);
    expect(blocks.map((b: any) => b.depth)).toEqual([0, 1, 2, 0]);
  });

  it("U8: tables parse header, delimiter, and rows; strikethrough parses", () => {
    const blocks = parseMarkdownText("| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | ~~gone~~ |");
    expect(blocks.map((b) => b.kind)).toEqual(["table"]);
    const table = blocks[0] as any;
    expect(table.headers.map((c: any) => c[0].text)).toEqual(["a", "b"]);
    expect(table.rows).toHaveLength(2);
    expect(table.rows[1][1]).toMatchObject([{ text: "gone", strike: true }]);
  });

  it("U8: strikethrough and link syntax inside code spans stays literal", () => {
    const spans = parseInline("`~~x~~` and `[y](https://y.test)`");
    expect(spans.map((s) => s.text).join("")).toBe("~~x~~ and [y](https://y.test)");
    expect(spans.every((s) => !s.link && !s.strike)).toBe(true);
  });

  it("groups plain paragraphs into a single text block", () => {
    const blocks = parseMarkdownText("line one\nline two");
    expect(blocks.length).toBe(1);
    expect(blocks[0]).toMatchObject({ kind: "text" });
  });
});