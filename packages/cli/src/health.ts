import { getErrorMessage, formatHealth, loadHealthSnapshot } from "@anvil/core";

/**
 * Phase 26.5 — `anvil health`.
 * Renders the project's latest health snapshot (latest-only, per spec). A
 * project with no recorded scans is an honest empty state, not zeroes dressed
 * up as data.
 */
export function runHealth(opts: { cwd?: string }): number {
  const cwd = opts.cwd ?? process.cwd();
  try {
    const snapshot = loadHealthSnapshot(cwd);
    if (!snapshot || snapshot.scansRun === 0) {
      process.stdout.write(
        `anvil health: no scans recorded for ${cwd} yet.\n` +
          "Run `anvil gate` (or `anvil gate --staged`) to record one.\n"
      );
      return 0;
    }
    process.stdout.write(formatHealth(snapshot, cwd) + "\n");
    return 0;
  } catch (err: unknown) {
    process.stderr.write(`anvil health failed: ${getErrorMessage(err)}\n`);
    return 1;
  }
}
