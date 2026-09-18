import { getErrorMessage, guardedInit } from "@anvil/core";

/**
 * Phase 25.6 — `anvil init --guarded [--lang <id>]`.
 * Provisions AGENTS.md + .fresh-allowlist.json in the current project.
 */
export function runGuardedInit(opts: { lang?: string; cwd?: string }): number {
  const cwd = opts.cwd ?? process.cwd();
  const lang = opts.lang && opts.lang.trim().length > 0 ? opts.lang.trim() : "typescript";
  try {
    const result = guardedInit(cwd, lang);
    for (const rel of result.created) process.stdout.write(`anvil init: created ${rel}\n`);
    for (const rel of result.skipped) process.stdout.write(`anvil init: kept existing ${rel}\n`);
    return 0;
  } catch (err: unknown) {
    process.stderr.write(`anvil init failed: ${getErrorMessage(err)}\n`);
    return 1;
  }
}
