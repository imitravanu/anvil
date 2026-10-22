import { CLIPBOARD_MAX_BYTES, CLIPBOARD_WRITE_TIMEOUT_MS } from "@anvil/core";
import { spawn } from "node:child_process";

/**
 * DW-4.11 — OSC 52 clipboard. Writes to STDERR (same pty as stdout, but never
 * Ink-owned), so sequences can't tear mid-frame. Works over SSH/tmux.
 * Pure builders + one guarded write; never throws.
 */

/** OSC 52 set-clipboard sequence for text (base64, BEL-terminated). Pure. */
export function osc52Sequence(text: string): string {
  const base64 = Buffer.from(text, "utf8").toString("base64");
  return `\u001b]52;c;${base64}\u0007`;
}

export interface ClipboardResult {
  ok: boolean;
  /** Machine-readable reason for UI feedback. */
  reason: "copied" | "empty" | "too-large" | "not-a-tty" | "write-failed";
  bytes?: number;
}

export interface ClipboardStream {
  write: (chunk: string) => void;
  isTTY?: boolean;
}

export function copyToClipboard(
  text: string,
  stream: ClipboardStream = process.stderr,
  maxBytes: number = CLIPBOARD_MAX_BYTES
): ClipboardResult {
  if (text.length === 0) return { ok: false, reason: "empty" };
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > maxBytes) return { ok: false, reason: "too-large", bytes };
  // `!== true`, not `=== false`: a PIPED stream reports isTTY as undefined, not
  // false, so the old test failed open and wrote the OSC sequence into whatever
  // the user redirected stderr to — while reporting "copied". altScreen.ts
  // already uses this form.
  if (stream.isTTY !== true) return { ok: false, reason: "not-a-tty", bytes };
  try {
    stream.write(osc52Sequence(text));
    return { ok: true, reason: "copied", bytes };
  } catch {
    // intentional: OSC 52 is best-effort on the user's terminal and a property
    // of the clip pipe (piped redirect); the copy already failed cleanly.
    return { ok: false, reason: "write-failed", bytes };
  }
}

/** Prefer a confirmed local clipboard write; OSC 52 remains the SSH fallback. */
export async function copySelection(text: string, stream: ClipboardStream = process.stderr): Promise<ClipboardResult & { confirmed?: boolean }> {
  const bytes = Buffer.byteLength(text, "utf8");
  if (!text) return { ok: false, reason: "empty", bytes };
  if (bytes > CLIPBOARD_MAX_BYTES) return { ok: false, reason: "too-large", bytes };
  if (stream.isTTY !== true) return { ok: false, reason: "not-a-tty", bytes };
  const commands: string[][] = [];
  if (process.platform === "linux" && !process.env.SSH_CONNECTION && !process.env.SSH_TTY) {
    if (process.env.WAYLAND_DISPLAY) commands.push(["wl-copy"]);
    if (process.env.DISPLAY) commands.push(["xclip", "-selection", "clipboard", "-in"]);
  } else if (process.platform === "darwin" && !process.env.SSH_CONNECTION && !process.env.SSH_TTY) commands.push(["pbcopy"]);
  for (const [command, ...args] of commands) {
    const copied = await new Promise<boolean>(resolve => {
      const env = Object.fromEntries(["PATH", "HOME", "DISPLAY", "WAYLAND_DISPLAY", "XDG_RUNTIME_DIR", "XAUTHORITY", "DBUS_SESSION_BUS_ADDRESS", "LANG", "LC_ALL", "LC_CTYPE"].flatMap(key => process.env[key] === undefined ? [] : [[key, process.env[key]]]));
      const child = spawn(command, args, { env, stdio: ["pipe", "ignore", "ignore"], timeout: CLIPBOARD_WRITE_TIMEOUT_MS });
      child.once("error", () => resolve(false));
      child.once("close", code => resolve(code === 0));
      child.stdin.on("error", () => { /* intentional: EPIPE is handled by the process error/exit result. */ });
      child.stdin.end(text);
    });
    if (copied) return { ok: true, reason: "copied", bytes, confirmed: true };
  }
  return { ...copyToClipboard(text, stream), confirmed: false };
}
