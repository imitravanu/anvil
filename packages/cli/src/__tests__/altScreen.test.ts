import { describe, expect, it } from "vitest";
import {
  ALT_SCREEN_ENTER,
  ALT_SCREEN_EXIT,
  enterAltScreen,
  exitAltScreen,
  isAltScreenActive,
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
  it("enters once, ignores re-entry, and exits on an injected stream", () => {
    const stream = memStream(true);
    exitAltScreen(stream); // reset the module flag deterministically
    expect(enterAltScreen(stream)).toBe(true);
    expect(enterAltScreen(stream)).toBe(true);
    expect(stream.chunks).toEqual([ALT_SCREEN_ENTER]);
    exitAltScreen(stream);
    expect(stream.chunks).toEqual([ALT_SCREEN_ENTER, ALT_SCREEN_EXIT]);
    expect(isAltScreenActive()).toBe(false);
  });

  it("enter is a no-op on unsupported streams", () => {
    const stream = memStream(false);
    exitAltScreen(stream);
    expect(enterAltScreen(stream)).toBe(false);
    expect(stream.chunks).toEqual([]);
  });

  it("emits the smcup/rmcup sequences", () => {
    expect(ALT_SCREEN_ENTER).toContain("[?1049h");
    expect(ALT_SCREEN_EXIT).toContain("[?1049l");
  });
});
