import { describe, expect, it } from "vitest";
import {
  bellSequence,
  desktopNotifySequence,
  notifyTurnComplete,
  shouldNotifyTurn,
} from "../notify.js";

function memoryStream(isTTY?: boolean): { chunks: string[]; isTTY?: boolean; write: (c: string) => void } {
  const chunks: string[] = [];
  return { chunks, isTTY, write: (c: string) => void chunks.push(c) };
}

describe("shouldNotifyTurn", () => {
  it("fires at and above the threshold only", () => {
    expect(shouldNotifyTurn(59_999, 60_000)).toBe(false);
    expect(shouldNotifyTurn(60_000, 60_000)).toBe(true);
    expect(shouldNotifyTurn(120_000, 60_000)).toBe(true);
  });
});

describe("sequences", () => {
  it("bell is a single BEL", () => {
    expect(bellSequence()).toBe("\x07");
  });

  it("desktop sequence carries title and body on both OSC channels", () => {
    const seq = desktopNotifySequence("Anvil", "done");
    expect(seq).toContain("]777;notify;Anvil;done");
    expect(seq).toContain("]9;Anvil: done");
  });

  it("strips control bytes from notification text", () => {
    const seq = desktopNotifySequence("a\x07b", "c\nd");
    expect(seq).toContain("a b");
    expect(seq).toContain("c d");
  });
});

describe("notifyTurnComplete", () => {
  it("stays silent for short turns", () => {
    const stream = memoryStream(true);
    expect(notifyTurnComplete(1_000, "done", stream, { thresholdMs: 60_000 })).toBe(false);
    expect(stream.chunks).toEqual([]);
  });

  it("emits desktop + bell for long turns on a TTY", () => {
    const stream = memoryStream(true);
    expect(notifyTurnComplete(61_000, "done", stream, { thresholdMs: 60_000 })).toBe(true);
    expect(stream.chunks.join("")).toContain("]777;notify;");
    expect(stream.chunks.join("")).toContain("\x07");
  });

  it("honors disabled channels and non-TTY streams", () => {
    const off = memoryStream(true);
    expect(notifyTurnComplete(61_000, "done", off, { thresholdMs: 1, desktop: false, sound: false })).toBe(false);
    const piped = memoryStream(false);
    expect(notifyTurnComplete(61_000, "done", piped, { thresholdMs: 1 })).toBe(false);
    expect(piped.chunks).toEqual([]);
  });
});
