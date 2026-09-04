import { describe, expect, it } from "vitest";
import { highlightCodeBlocks } from "../highlightCodeBlocks.js";

describe("highlightCodeBlocks — NO_COLOR support (Phase 8.5 U3)", () => {
  it("strips fences and emits NO ANSI escape codes when NO_COLOR is set", () => {
    process.env.NO_COLOR = "1";
    try {
      const out = highlightCodeBlocks("```js\nconst x = 1;\n```");
      expect(out).toBe("const x = 1;\n");
      expect(out.includes("\x1b")).toBe(false);
    } finally {
      delete process.env.NO_COLOR;
    }
  });

  it("leaves non-fence text untouched under NO_COLOR", () => {
    process.env.NO_COLOR = "1";
    try {
      const text = "plain **text** without fences";
      expect(highlightCodeBlocks(text)).toBe(text);
    } finally {
      delete process.env.NO_COLOR;
    }
  });
});