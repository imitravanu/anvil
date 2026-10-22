import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLIPBOARD_MAX_BYTES, CLIPBOARD_WRITE_TIMEOUT_MS } from "@imitravanu/anvil-core";
import { copySelection } from "../clipboard.js";

const fixtures = vi.hoisted(() => ({ outcomes: [] as boolean[], writes: [] as string[], calls: [] as Array<{ command: string; args: string[]; options: Record<string, unknown> }> }));
vi.mock("node:child_process", async importOriginal => ({ ...await importOriginal<typeof import("node:child_process")>(), spawn: (command: string, args: string[], options: Record<string, unknown>) => {
  fixtures.calls.push({ command, args, options });
  const child = new EventEmitter();
  const stdin = Object.assign(new EventEmitter(), { end: (text: string) => {
    fixtures.writes.push(text);
    queueMicrotask(() => fixtures.outcomes.shift() ? child.emit("close", 0) : child.emit("error", Object.assign(new Error("unavailable"), { code: "ENOENT" })));
  } });
  return Object.assign(child, { stdin });
} }));
const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
beforeEach(() => {
  Object.defineProperty(process, "platform", { value: "linux", configurable: true });
  for (const key of ["SSH_CONNECTION", "SSH_TTY", "WAYLAND_DISPLAY", "DISPLAY"]) vi.stubEnv(key, "");
  fixtures.calls.length = 0; fixtures.writes.length = 0; fixtures.outcomes.length = 0;
});
afterEach(() => { Object.defineProperty(process, "platform", platform); vi.unstubAllEnvs(); });
const stream = () => ({ isTTY: true, write: vi.fn() });

describe("automatic selection clipboard", () => {
  it("writes selected text as stdin without a shell or provider credentials", async () => {
    vi.stubEnv("WAYLAND_DISPLAY", "fixture"); vi.stubEnv("PRIVATE_PROVIDER_KEY", "must-not-leak");
    fixtures.outcomes.push(true);
    const output = stream();
    await expect(copySelection("$(not a command)\n  code", output)).resolves.toMatchObject({ ok: true, confirmed: true });
    expect(fixtures.writes).toEqual(["$(not a command)\n  code"]);
    expect(fixtures.calls[0]).toMatchObject({ command: "wl-copy", args: [], options: { timeout: CLIPBOARD_WRITE_TIMEOUT_MS } });
    expect(fixtures.calls[0].options).not.toHaveProperty("shell");
    expect(fixtures.calls[0].options.env).not.toHaveProperty("PRIVATE_PROVIDER_KEY");
    expect(output.write).not.toHaveBeenCalled();
  });
  it("falls back to X11 after unavailable Wayland, then OSC 52 without falsely confirming it", async () => {
    vi.stubEnv("WAYLAND_DISPLAY", "fixture"); vi.stubEnv("DISPLAY", "fixture");
    fixtures.outcomes.push(false, true);
    await expect(copySelection("copy me", stream())).resolves.toMatchObject({ ok: true, confirmed: true });
    expect(fixtures.calls.map(call => call.command)).toEqual(["wl-copy", "xclip"]);
    const output = stream();
    await expect(copySelection("fallback", output)).resolves.toMatchObject({ ok: true, confirmed: false });
    expect(output.write).toHaveBeenCalledWith(expect.stringContaining("]52;c;"));
  });
  it("uses terminal clipboard over SSH and never writes oversized text or redirected output", async () => {
    vi.stubEnv("WAYLAND_DISPLAY", "fixture"); vi.stubEnv("SSH_CONNECTION", "fixture");
    await expect(copySelection("remote text", stream())).resolves.toMatchObject({ ok: true, confirmed: false });
    expect(fixtures.calls).toEqual([]);
    const output = stream();
    await expect(copySelection("x".repeat(CLIPBOARD_MAX_BYTES + 1), output)).resolves.toMatchObject({ ok: false, reason: "too-large" });
    await expect(copySelection("text", { ...output, isTTY: false })).resolves.toMatchObject({ ok: false, reason: "not-a-tty" });
    expect(output.write).not.toHaveBeenCalled();
  });
});
