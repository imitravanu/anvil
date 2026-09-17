/**
 * DW-4.7 — alternate screen buffer (smcup/rmcup). Anvil renders inline today,
 * polluting shell scrollback; the alt screen gives clean enter/exit with zero
 * leftover frames. Skipped when not a TTY, on dumb terminals, or via
 * ANVIL_NO_ALT_SCREEN=1. Enter/exit are idempotent (paired flag) so the
 * setup-then-chat boot path can never strand the terminal.
 */

export const ALT_SCREEN_ENTER = "\u001b[?1049h\u001b[H";
export const ALT_SCREEN_EXIT = "\u001b[?1049l";

export interface AltScreenCapable {
  isTTY?: boolean;
}

export function isAltScreenSupported(
  stdout: AltScreenCapable = process.stdout,
  env: Record<string, string | undefined> = process.env
): boolean {
  if (stdout.isTTY !== true) return false;
  if ((env.TERM ?? "") === "dumb") return false;
  if ((env.ANVIL_NO_ALT_SCREEN ?? "") === "1") return false;
  return true;
}

let active = false;

export function isAltScreenActive(): boolean {
  return active;
}

export interface AltScreenStream extends AltScreenCapable {
  write: (chunk: string) => void;
}

function writeSeq(seq: string, stream: AltScreenStream): void {
  try {
    stream.write(seq);
  } catch {
    // A failed escape write must never crash boot or exit handling.
  }
}

/**
 * Enter once; no-op when unsupported or already active. Returns entered.
 * The stream is injectable for tests; production always passes stdout.
 */
export function enterAltScreen(stream: AltScreenStream = process.stdout as AltScreenStream): boolean {
  if (active || !isAltScreenSupported(stream, {})) return active;
  writeSeq(ALT_SCREEN_ENTER, stream);
  active = true;
  return true;
}

/** Exit once; safe to call from exit handlers (sync write only). */
export function exitAltScreen(stream: AltScreenStream = process.stdout as AltScreenStream): void {
  if (!active) return;
  active = false;
  writeSeq(ALT_SCREEN_EXIT, stream);
}
