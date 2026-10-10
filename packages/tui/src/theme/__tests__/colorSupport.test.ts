import { describe, expect, it } from "vitest";
import { detectColorSupport } from "../colorSupport.js";

describe("detectColorSupport", () => {
  it("NO_COLOR wins over everything (presence, any value)", () => {
    expect(detectColorSupport({ NO_COLOR: "", COLORTERM: "truecolor", TERM: "xterm-256color" })).toBe("none");
    expect(detectColorSupport({ NO_COLOR: "1", TERM: "xterm" })).toBe("none");
  });

  it("dumb terminals get no color", () => {
    expect(detectColorSupport({ TERM: "dumb" })).toBe("none");
    expect(detectColorSupport({ TERM: "DUMB", COLORTERM: "truecolor" })).toBe("none");
  });

  it("detects truecolor via COLORTERM", () => {
    expect(detectColorSupport({ COLORTERM: "truecolor", TERM: "xterm" })).toBe("truecolor");
    expect(detectColorSupport({ COLORTERM: "24bit", TERM: "xterm" })).toBe("truecolor");
    expect(detectColorSupport({ COLORTERM: "TrueColor", TERM: "xterm" })).toBe("truecolor");
  });

  it("detects 256 palettes", () => {
    expect(detectColorSupport({ TERM: "xterm-256color" })).toBe("palette256");
    expect(detectColorSupport({ COLORTERM: "yes", TERM: "xterm" })).toBe("palette256");
  });

  it("falls back to basic, never throws on empty env", () => {
    expect(detectColorSupport({ TERM: "xterm" })).toBe("basic");
    expect(detectColorSupport({})).toBe("basic");
  });
});
