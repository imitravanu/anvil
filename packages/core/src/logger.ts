/**
 * Structured logger for Anvil.
 * Writes diagnostic and operational messages to stderr to keep stdout clean.
 */
export const log = {
  info: (msg: string): void => {
    process.stderr.write(`[anvil] ${msg}\n`);
  },
  warn: (msg: string): void => {
    process.stderr.write(`[anvil] ⚠ ${msg}\n`);
  },
  error: (msg: string): void => {
    process.stderr.write(`[anvil] ✗ ${msg}\n`);
  },
  debug: (msg: string): void => {
    if (process.env.ANVIL_DEBUG) {
      process.stderr.write(`[anvil] 🔍 ${msg}\n`);
    }
  },
};
