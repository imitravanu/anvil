import { describe, expect, it } from "vitest";
import {
  ALT_SCREEN_ENTER,
  ALT_SCREEN_EXIT,
  enterAltScreen,
  exitAltScreen,
  isAltScreenSupported,
} from "../altScreen.js";

function memStream(isTTY?: boolean): { chunks: string[]; isTTY?: boolean; write: (c: string) => void } {
  const chunks: string[] = [];
  return { chunks, isTTY, write: (c: string) => void chunks.push(c) };
}

describe("isAltScreenSupported", () => {
  it("requires a TTY without opt-outs", () => {
    expect(isAltScreenSupported({ isTTY: true }, {})).toBe(true);
    expect(isAltScreenSupported({ isTTY: true }, { TERM: "xterm-256color" })).toBe(true);
  });

  it("refuses pipes, dumb terminals, and the escape hatch", () => {
    expect(isAltScreenSupported({ isTTY: false }, {})).toBe(false);
    expect(isAltScreenSupported({}, {})).toBe(false);
    expect(isAltScreenSupported({ isTTY: true }, { TERM: "dumb" })).toBe(false);
    expect(isAltScreenSupported({ isTTY: true }, { ANVIL_NO_ALT_SCREEN: "1" })).toBe(false);
  });
});

describe("enter/exit pairing", () => {
  it("pairs SGR mouse reporting with the fullscreen lifetime, including repeated exit", () => {
    const stream = memStream(true);
    exitAltScreen(stream);
    enterAltScreen(stream, {});
    expect(stream.chunks.join("")).toContain("\x1b[?1002h\x1b[?1006h");
    exitAltScreen(stream);
    expect(stream.chunks.join("")).toContain("\x1b[?1006l\x1b[?1002l\x1b[?1000l");
    const count = stream.chunks.length;
    exitAltScreen(stream);
    expect(stream.chunks).toHaveLength(count);
  });

  it("allows mouse reporting to be disabled without disabling fullscreen", () => {
    const stream = memStream(true);
    exitAltScreen(stream);
    enterAltScreen(stream, { ANVIL_NO_MOUSE: "1" });
    exitAltScreen(stream);
    expect(stream.chunks.join("")).toContain(ALT_SCREEN_ENTER);
    expect(stream.chunks.join("")).not.toMatch(/\[\?100[026][hl]/);
  });

  it("enters once, ignores re-entry, and exits on an injected stream", () => {
    const stream = memStream(true);
    exitAltScreen(stream); // reset the module flag deterministically
    // Explicit {} env keeps the test hermetic — production passes process.env.
    expect(enterAltScreen(stream, {})).toBe(true);
    expect(enterAltScreen(stream, {})).toBe(true);
    expect(stream.chunks).toEqual([ALT_SCREEN_ENTER, "\x1b[?1002h\x1b[?1006h"]);
    exitAltScreen(stream);
    expect(stream.chunks).toEqual([ALT_SCREEN_ENTER, "\x1b[?1002h\x1b[?1006h", "\x1b[?1006l\x1b[?1002l\x1b[?1000l", ALT_SCREEN_EXIT]);
  });

  it("enter is a no-op on unsupported streams", () => {
    const stream = memStream(false);
    exitAltScreen(stream);
    expect(enterAltScreen(stream, {})).toBe(false);
    expect(stream.chunks).toEqual([]);
  });

  it("honors the documented opt-outs through enterAltScreen, not just the predicate", () => {
    // Regression: enterAltScreen used to pass a literal {} as the env, so
    // TERM=dumb and ANVIL_NO_ALT_SCREEN=1 (both named in --help) were inert and
    // a TTY always switched buffers.
    const stream = memStream(true);
    exitAltScreen(stream);
    expect(enterAltScreen(stream, { TERM: "dumb" })).toBe(false);
    expect(enterAltScreen(stream, { ANVIL_NO_ALT_SCREEN: "1" })).toBe(false);
    expect(stream.chunks).toEqual([]);
  });

  it("emits the smcup/rmcup sequences", () => {
    expect(ALT_SCREEN_ENTER).toContain("[?1049h");
    expect(ALT_SCREEN_EXIT).toContain("[?1049l");
  });
});
