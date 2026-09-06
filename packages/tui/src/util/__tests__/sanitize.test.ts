import { describe, expect, it } from "vitest";
import { sanitizeTerminalText } from "../sanitize.js";

describe("sanitizeTerminalText", () => {
  it("keeps the last \r segment (npm/pip progress overwrite semantics)", () => {
    expect(sanitizeTerminalText("downloading… 3%\rdownloading… 97%\rdone")).toBe("done");
    // \r\n is a plain newline: each side keeps its own last segment
    expect(sanitizeTerminalText("Progress update:\r\n✔ tests passed")).toBe(
      "Progress update:\n✔ tests passed"
    );
  });

  it("strips ANSI color/cursor sequences", () => {
    expect(sanitizeTerminalText("\u001b[32m✔ passed\u001b[0m in \u001b[1m2.4s\u001b[22m")).toBe(
      "✔ passed in 2.4s"
    );
    expect(sanitizeTerminalText("\u001b]0;title\u0007rest")).toBe("rest");
    expect(sanitizeTerminalText("\u001b[2Kclear")).toBe("clear");
  });

  it("expands tabs and drops other C0 controls", () => {
    expect(sanitizeTerminalText("a\tb")).toBe("a  b");
    expect(sanitizeTerminalText("a\u0007b\u007fc")).toBe("abc");
  });

  it("leaves ordinary text untouched", () => {
    const t = "Hello — world! ✔✓ ─── │ code `x`";
    expect(sanitizeTerminalText(t)).toBe(t);
  });
});
