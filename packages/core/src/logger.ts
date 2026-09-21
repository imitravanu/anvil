/**
 * Structured logger for Anvil.
 * Writes diagnostic and operational messages to stderr to keep stdout clean.
 *
 * Levels, gated by ANVIL_LOG (unset → "warn"):
 *   "debug" → debug, info, warn, error   (verbose diagnostics)
 *   "info"  → info, warn, error          (operational visibility)
 *   "warn"  → warn, error                (default: problems only)
 *   "error" → error only                 (quiet)
 *   "silent" → nothing
 * ANVIL_DEBUG=1 is honored as an alias for ANVIL_LOG=debug (legacy flag).
 *
 * The level is read lazily per call so tests can flip it via env without
 * re-importing, and so a runtime `--verbose` flag can set it before any
 * logging happens. console.* call sites in core migrate here rather than
 * gaining their own format — one stderr writer, one prefix, one gate.
 */
export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 99,
};

export function resolveLogLevel(): LogLevel {
  const raw = (process.env.ANVIL_LOG ?? "").trim().toLowerCase();
  if (raw in LEVEL_ORDER) return raw as LogLevel;
  // Legacy: ANVIL_DEBUG predates the level gate.
  if (process.env.ANVIL_DEBUG) return "debug";
  return "warn";
}

function enabled(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[resolveLogLevel()];
}

function write(prefix: string, msg: string): void {
  try {
    process.stderr.write(`[anvil] ${prefix}${msg}\n`);
  } catch {
    // A closed/piped stderr must never crash the caller mid-turn.
  }
}

export const log = {
  debug: (msg: string): void => {
    if (enabled("debug")) write("🔍 ", msg);
  },
  info: (msg: string): void => {
    if (enabled("info")) write("", msg);
  },
  warn: (msg: string): void => {
    if (enabled("warn")) write("⚠ ", msg);
  },
  error: (msg: string): void => {
    if (enabled("error")) write("✗ ", msg);
  },
};
