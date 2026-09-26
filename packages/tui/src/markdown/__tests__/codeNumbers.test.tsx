import { describe, expect, it } from "vitest";
import React from "react";
import { MarkdownView, parseMarkdownText, fenceStartLine } from "../MarkdownView.js";
import { frameText, renderThemed } from "../../test-utils/testRender.js";

/**
 * Phase 28.11 — code-block line numbers.
 *
 * Numbering from three lines up, right-aligned to the widest number, honoring
 * a `#L<N>` fence anchor so the gutter matches the file on disk, and keeping
 * TRUE numbers across the head+tail window (a tail must read 48-50, not 1-3).
 * One-liners and pairs stay clean: a gutter on a snippet costs more than it
 * orients.
 */

function renderMarkdown(text: string): string {
  const { lastFrame, unmount } = renderThemed(<MarkdownView blocks={parseMarkdownText(text)} />);
  const out = frameText(lastFrame);
  unmount();
  return out;
}

describe("fenceStartLine", () => {
  it("defaults to 1 without an anchor", () => {
    expect(fenceStartLine("typescript")).toBe(1);
    expect(fenceStartLine("typescript:src/auth.ts")).toBe(1);
  });

  it("reads a #L anchor — the gutter must match the file on disk", () => {
    expect(fenceStartLine("typescript:src/auth.ts#L24")).toBe(24);
  });

  it("refuses nonsense anchors rather than numbering from zero", () => {
    expect(fenceStartLine("js#L0")).toBe(1);
  });
});

describe("code block line numbers", () => {
  it("numbers code from three lines up", () => {
    const out = renderMarkdown("```js\nlet a = 1;\nlet b = 2;\nlet c = 3;\n```");
    expect(out).toContain("1 │ let a = 1;");
    expect(out).toContain("2 │ let b = 2;");
    expect(out).toContain("3 │ let c = 3;");
  });

  it("leaves short snippets clean — no gutter below three lines", () => {
    const out = renderMarkdown("```js\nlet a = 1;\nlet b = 2;\n```");
    expect(out).toContain("let a = 1;");
    expect(out).not.toContain("1 │");
  });

  it("right-aligns to the widest number in the block", () => {
    const twelve = ["```js", ...Array.from({ length: 12 }, (_, i) => `let v${i + 1} = ${i + 1};`), "```"].join("\n");
    const out = renderMarkdown(twelve);
    expect(out).toContain(" 1 │ let v1 = 1;");
    expect(out).toContain("12 │ let v12 = 12;");
  });

  it("numbers from the fence's #L anchor", () => {
    const out = renderMarkdown("```typescript:src/auth.ts#L24\nlet x = 1;\nlet y = 2;\nlet z = 3;\n```");
    expect(out).toContain("24 │ let x = 1;");
    expect(out).toContain("26 │ let z = 3;");
    expect(out).not.toContain(" 1 │");
  });

  it("keeps true line numbers across the head+tail window", () => {
    const twenty = ["```js", ...Array.from({ length: 20 }, (_, i) => `line ${i + 1};`), "```"].join("\n");
    const out = renderMarkdown(twenty);
    // Head 1..10, unnumbered omission notice, tail 18..20.
    expect(out).toContain(" 1 │ line 1;");
    expect(out).toContain("10 │ line 10;");
    expect(out).toContain("18 │ line 18;");
    expect(out).toContain("20 │ line 20;");
    // The windowed middle must not leak phantom numbering.
    expect(out).not.toContain("11 │");
    expect(out).not.toContain("17 │");
  });
});
