import { execSync, spawnSync } from "node:child_process";
import { getErrorMessage, scanDiffForSlop } from "@anvil/core";

/**
 * Phase 25.6 — native `anvil gate` command.
 * Fast mode (default): in-process guardian scan over the working-tree diff.
 * Full mode (--full): delegates to the repo's `npm run gate` pipeline.
 */
export function runNativeGate(opts: { full?: boolean; cwd?: string }): number {
  const cwd = opts.cwd ?? process.cwd();
  if (opts.full) {
    const child = spawnSync("npm", ["run", "gate"], { cwd, stdio: "inherit", shell: process.platform === "win32" });
    if (child.error) {
      process.stderr.write(`anvil gate --full failed to launch: ${getErrorMessage(child.error)}\n`);
      return 1;
    }
    return child.status ?? 1;
  }

  let diff = "";
  try {
    diff = execSync("git diff HEAD -- . ':!node_modules' ':!dist'", { cwd, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  } catch (err: unknown) {
    process.stderr.write(`anvil gate: cannot read git diff: ${getErrorMessage(err)}\n`);
    return 1;
  }
  if (!diff.trim()) {
    process.stdout.write("anvil gate: clean tree — nothing to scan.\n");
    return 0;
  }
  const violations = scanDiffForSlop("(working tree)", diff);
  if (violations.length === 0) {
    process.stdout.write("anvil gate: fast scan passed (no slop in working-tree diff).\n");
    return 0;
  }
  process.stdout.write(`anvil gate: ${violations.length} violation(s):\n`);
  for (const v of violations.slice(0, 50)) {
    process.stdout.write(`  ${v.file}:${v.line} [${v.rule}] ${v.detail}\n`);
  }
  process.stdout.write("Run `npm run gate` for the full pipeline.\n");
  return 1;
}
