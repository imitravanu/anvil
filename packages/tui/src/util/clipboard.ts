import { CLIPBOARD_MAX_BYTES } from "@anvil/core";

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
  if (stream.isTTY === false) return { ok: false, reason: "not-a-tty", bytes };
  try {
    stream.write(osc52Sequence(text));
    return { ok: true, reason: "copied", bytes };
  } catch {
    return { ok: false, reason: "write-failed", bytes };
  }
}
