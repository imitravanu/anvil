import { describe, it, expect, vi, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { readStdin } from "../headless.js";

// readStdin talks to process.stdin directly, so the only faithful test is a
// stand-in stream swapped in for the duration. It must expose the four members
// readStdin touches: isTTY, on, removeListener, destroy.
class FakeStdin extends EventEmitter {
  isTTY = false;
  destroyed = false;
  destroy(): void {
    this.destroyed = true;
  }
}

let restore: (() => void) | null = null;
function swapStdin(fake: FakeStdin): void {
  const original = process.stdin;
  Object.defineProperty(process, "stdin", { value: fake, configurable: true, writable: true });
  restore = () => {
    Object.defineProperty(process, "stdin", { value: original, configurable: true, writable: true });
  };
}

afterEach(() => {
  restore?.();
  restore = null;
  vi.useRealTimers();
});

describe("readStdin (non-TTY)", () => {
  it("concatenates buffered chunks until end", async () => {
    const fake = new FakeStdin();
    swapStdin(fake);
    const p = readStdin(1_000, 1024, 5_000);
    fake.emit("data", Buffer.from("hello "));
    fake.emit("data", Buffer.from("world"));
    fake.emit("end");
    expect(await p).toBe("hello world");
  });

  it("truncates at the byte cap and says so", async () => {
    const fake = new FakeStdin();
    swapStdin(fake);
    const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const p = readStdin(1_000, 5, 5_000);
    fake.emit("data", Buffer.from("abcdefghij"));
    expect(await p).toBe("abcde");
    expect(err.mock.calls.map((c) => c[0]).join("")).toContain("truncating");
  });

  it("proceeds after the idle window with no EOF, destroying the stream", async () => {
    vi.useFakeTimers();
    const fake = new FakeStdin();
    swapStdin(fake);
    const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const p = readStdin(50, 1024, 5_000);
    fake.emit("data", Buffer.from("partial"));
    await vi.advanceTimersByTimeAsync(50);
    expect(await p).toBe("partial");
    expect(fake.destroyed).toBe(true);
    expect(err.mock.calls.map((c) => c[0]).join("")).toContain("no EOF on stdin");
  });

  it("resolves empty on a stream error rather than hanging", async () => {
    const fake = new FakeStdin();
    swapStdin(fake);
    const p = readStdin(1_000, 1024, 5_000);
    fake.emit("error", new Error("boom"));
    expect(await p).toBe("");
  });

  it("enforces the hard timeout even while data keeps arriving", async () => {
    vi.useFakeTimers();
    const fake = new FakeStdin();
    swapStdin(fake);
    const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const p = readStdin(10_000, 1024, 100);
    fake.emit("data", Buffer.from("drip"));
    await vi.advanceTimersByTimeAsync(100);
    expect(await p).toBe("drip");
    expect(err.mock.calls.map((c) => c[0]).join("")).toContain("hard timeout");
  });
});
