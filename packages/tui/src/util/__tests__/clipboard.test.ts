import { describe, expect, it } from "vitest";
import { copyToClipboard, osc52Sequence } from "../clipboard.js";

function memoryStream(isTTY?: boolean): { chunks: string[]; isTTY?: boolean; write: (c: string) => void } {
  const chunks: string[] = [];
  return { chunks, isTTY, write: (c: string) => void chunks.push(c) };
}

describe("osc52Sequence", () => {
  it("round-trips text through base64 between OSC markers", () => {
    const seq = osc52Sequence("hello");
    expect(seq).toContain("]52;c;");
    const payload = seq.split("]52;c;")[1].replace(/\x07$/, "");
    expect(Buffer.from(payload, "base64").toString("utf8")).toBe("hello");
  });
});

describe("copyToClipboard", () => {
  it("copies text on a TTY stream", () => {
    const stream = memoryStream(true);
    const result = copyToClipboard("code()", stream);
    expect(result).toEqual({ ok: true, reason: "copied", bytes: 6 });
    expect(stream.chunks).toHaveLength(1);
  });

  it("refuses empty text, oversize payloads, and pipes", () => {
    expect(copyToClipboard("", memoryStream(true))).toEqual({ ok: false, reason: "empty" });
    expect(copyToClipboard("1234567890", memoryStream(true), 5)).toEqual({
      ok: false,
      reason: "too-large",
      bytes: 10,
    });
    const piped = memoryStream(false);
    expect(copyToClipboard("x", piped)).toEqual({ ok: false, reason: "not-a-tty", bytes: 1 });
    expect(piped.chunks).toEqual([]);
  });
});
