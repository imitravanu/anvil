import React from "react";
import { PassThrough } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it, vi } from "vitest";
import { render, Text, useInput, usePaste } from "ink";
import { interactiveRenderOptions } from "../interactiveRenderOptions.js";

class TerminalStream extends PassThrough {
  isTTY = true;
  columns = 80;
  rows = 24;
  raw = false;
  setRawMode(value: boolean) { this.raw = value; return this; }
  ref() { return this; }
  unref() { return this; }
}

describe("interactive startup input", () => {
  it.each([
    { name: "ordinary typing", bytes: "startup-text", expected: ["key:startup-text"] },
    { name: "bracketed multiline paste", bytes: "\x1b[200~first\n  second\n\x1b[201~", expected: ["paste:first\n  second\n"] },
    { name: "Enter", bytes: "\r", expected: ["enter"] },
    { name: "Ctrl+C", bytes: "\x03", expected: ["cancel"] },
  ])("delivers $name once without waiting for a terminal reply", async ({ bytes, expected }) => {
    const stdin = new TerminalStream();
    const stdout = new TerminalStream();
    const stderr = new TerminalStream();
    const output: string[] = [];
    stdout.on("data", chunk => output.push(String(chunk)));
    stderr.resume();
    const events: string[] = [];
    function Harness() {
      useInput((input, key) => events.push(key.return ? "enter" : key.ctrl && input === "c" ? "cancel" : `key:${input}`));
      usePaste(text => events.push(`paste:${text}`));
      return <Text>Ready</Text>;
    }
    const app = render(<Harness />, {
      ...interactiveRenderOptions, interactive: true, patchConsole: false,
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream,
      stderr: stderr as unknown as NodeJS.WriteStream,
    });
    try {
      await vi.waitFor(() => expect(stdin.raw).toBe(true), { interval: 1 });
      stdin.write(bytes);
      await vi.waitFor(() => expect(events.length).toBeGreaterThan(0), { interval: 1 });
      // Covers Ink 7's 200ms capability-probe timeout, not just the first delivery.
      await delay(250);
      expect(events).toEqual(expected);
      expect(output.join("")).not.toContain("\x1b[?u");
    } finally {
      app.unmount(); app.cleanup(); stdin.destroy(); stdout.destroy(); stderr.destroy();
    }
  });
});
