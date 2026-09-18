import { LONG_TURN_NOTIFY_MS } from "@anvil/core";

/**
 * DW-4.9 — turn completion attention signals. Bell + desktop notifications go
 * to STDERR, never Ink-owned stdout, so frames can't tear mid-redraw. All
 * sequences are pure builders; the only side effect is one guarded write.
 */

export interface NotifyOptions {
  desktop?: boolean;
  sound?: boolean;
  thresholdMs?: number;
}

/** True when a turn ran long enough to deserve attention. Pure. */
export function shouldNotifyTurn(elapsedMs: number, thresholdMs: number = LONG_TURN_NOTIFY_MS): boolean {
  return elapsedMs >= thresholdMs;
}

export function bellSequence(): string {
  // ESC char is BEL (0x07); written as an escape so no raw control byte
  // ever lives in source.
  return "\x07";
}

/**
 * Desktop notification: Kitty OSC 777 (with title) + iTerm2 OSC 9 fallback.
 * Unsupported terminals ignore both; nothing is ever printed as text.
 */
export function desktopNotifySequence(title: string, body: string): string {
  const clean = (s: string): string => s.replace(/[\x00-\x1f\x7f]/g, " ").slice(0, 200);
  const safeTitle = clean(title);
  const safeBody = clean(body);
  return (
    `\u001b]777;notify;${safeTitle};${safeBody}\u001b\\` +
    `\u001b]9;${safeTitle}: ${safeBody}\u001b\\`
  );
}

export interface NotifyStream {
  write: (chunk: string) => void;
  isTTY?: boolean;
}

/**
 * Notify turn completion when long. Returns true when anything was emitted.
 * Never throws; a failed write must not take the chat down.
 */
export function notifyTurnComplete(
  elapsedMs: number,
  summary: string,
  stream: NotifyStream = process.stderr,
  opts: NotifyOptions = {}
): boolean {
  if (!shouldNotifyTurn(elapsedMs, opts.thresholdMs)) return false;
  if (stream.isTTY === false) return false;
  const desktop = opts.desktop ?? true;
  const sound = opts.sound ?? true;
  if (!desktop && !sound) return false;
  try {
    if (desktop) stream.write(desktopNotifySequence("Anvil", summary));
    if (sound) stream.write(bellSequence());
    return true;
  } catch {
    return false;
  }
}
