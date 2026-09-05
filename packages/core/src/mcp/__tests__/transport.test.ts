import { describe, expect, it } from "vitest";
import { createLineSplitter } from "../transport.js";

describe("createLineSplitter", () => {
  it("frames lines across arbitrary chunk splits, multibyte-safe", () => {
    const lines: string[] = [];
    const splitter = createLineSplitter((l) => lines.push(l));
    const emoji = "héllo 🌍\nsecond\n";
    const buf = Buffer.from(emoji, "utf8");
    // Feed one byte at a time — every multibyte sequence gets split.
    for (let i = 0; i < buf.length; i++) splitter.push(buf.subarray(i, i + 1));
    expect(lines).toEqual(["héllo 🌍", "second"]);
  });

  it("strips CR and holds partial lines until newline", () => {
    const lines: string[] = [];
    const splitter = createLineSplitter((l) => lines.push(l));
    splitter.push(Buffer.from("one\r\ntwo"));
    expect(lines).toEqual(["one"]);
    splitter.push(Buffer.from("\n"));
    expect(lines).toEqual(["one", "two"]);
  });

  it("fails fast past the line cap instead of buffering forever", () => {
    const lines: string[] = [];
    let limited = 0;
    const splitter = createLineSplitter((l) => lines.push(l), {
      maxLineBytes: 16,
      onLimitExceeded: () => {
        limited += 1;
      },
    });
    splitter.push(Buffer.alloc(64, "x")); // no newline, over cap
    splitter.push(Buffer.from("\n"));
    expect(limited).toBe(1);
    expect(lines).toEqual([]); // monster line dropped, stream stays usable
  });
});
