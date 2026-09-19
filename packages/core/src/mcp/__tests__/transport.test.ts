import { describe, expect, it } from "vitest";
import { SseFrameParser, createLineSplitter, createTransportPump, isSameOrigin } from "../transport.js";
import { MCP_MAX_PUMP_QUEUE_BYTES, MCP_MAX_PUMP_QUEUE_LINES } from "../../config/constants.js";

/** Drain at most `limit` lines, so a pump that never finishes fails loudly instead of hanging. */
async function drainBounded(iter: AsyncIterable<string>, limit = 10_000): Promise<string[]> {
  const out: string[] = [];
  for await (const line of iter) {
    out.push(line);
    if (out.length >= limit) break;
  }
  return out;
}

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

describe("createTransportPump bounds", () => {
  it("delivers queued lines in order below the cap", async () => {
    const pump = createTransportPump();
    pump.deliver("one");
    pump.deliver("two");
    pump.finish();
    expect(await drainBounded(pump.lines())).toEqual(["one", "two"]);
  });

  it("fails the transport when the queue passes the line cap", async () => {
    const pump = createTransportPump();
    // One past the cap, with nothing draining the queue.
    for (let i = 0; i <= MCP_MAX_PUMP_QUEUE_LINES; i++) pump.deliver(`line-${i}`);
    // Overflow is deliberate and total: the queue is dropped and the stream
    // ends, so pending calls error as closed rather than the process growing.
    expect(await drainBounded(pump.lines())).toEqual([]);
  });

  it("fails the transport when the queue passes the byte cap under the line cap", async () => {
    const pump = createTransportPump();
    pump.deliver("x".repeat(MCP_MAX_PUMP_QUEUE_BYTES + 1));
    expect(await drainBounded(pump.lines())).toEqual([]);
  });

  it("never banks a message that arrives after finish", async () => {
    const pump = createTransportPump();
    pump.finish();
    pump.deliver("late");
    expect(await drainBounded(pump.lines())).toEqual([]);
  });
});

describe("SseFrameParser bounds", () => {
  it("flags an unterminated frame past the cap instead of buffering forever", () => {
    const parser = new SseFrameParser(64);
    expect(parser.push(`data: ${"x".repeat(200)}`)).toEqual([]);
    expect(parser.overflowed).toBe(true);
    // Terminal: the tail was dropped, so resyncing on later bytes could only
    // emit corrupted JSON-RPC.
    expect(parser.push("\n\n")).toEqual([]);
  });

  it("delivers complete frames normally while under the cap", () => {
    const parser = new SseFrameParser(64);
    expect(parser.push("data: hi\n\n")).toEqual([{ event: "message", data: "hi" }]);
    expect(parser.overflowed).toBe(false);
  });

  it("bounds the retained tail, not the inbound chunk", () => {
    // A chunk full of COMPLETE frames must not trip the cap: only the
    // unterminated remainder is ever retained.
    const parser = new SseFrameParser(32);
    const frames = Array.from({ length: 50 }, (_, i) => `data: ${i}\n\n`).join("");
    expect(parser.push(frames)).toHaveLength(50);
    expect(parser.overflowed).toBe(false);
  });
});

describe("isSameOrigin", () => {
  it("accepts the same origin, including an explicit default port", () => {
    expect(isSameOrigin("https://host/rpc", "https://host/sse")).toBe(true);
    expect(isSameOrigin("https://host:443/rpc", "https://host/sse")).toBe(true);
    expect(isSameOrigin("http://127.0.0.1:9/rpc", "http://127.0.0.1:9/sse")).toBe(true);
  });

  it("refuses a different host, port, or scheme", () => {
    expect(isSameOrigin("https://evil.invalid/rpc", "https://host/sse")).toBe(false);
    expect(isSameOrigin("https://host:8443/rpc", "https://host:443/sse")).toBe(false);
    expect(isSameOrigin("http://host/rpc", "https://host/sse")).toBe(false);
  });

  it("fails closed on unparseable input", () => {
    expect(isSameOrigin("not a url", "https://host/sse")).toBe(false);
    expect(isSameOrigin("https://host/rpc", "not a url")).toBe(false);
  });
});
