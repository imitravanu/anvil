import { execSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import {
  detectGuardianScope,
  getErrorMessage,
  loadCustomGuardianRules,
  recordHealthScan,
  scanDiffForSlop,
  GATE_DIFF_MAX_BUFFER_BYTES,
  GATE_DIFF_SCAN_TIMEOUT_MS,
  GUARDIAN_WATCH_INTERVAL_MS,
  GUARDIAN_WATCH_MAX_SCANS_PER_MIN,
  type GuardianViolation,
} from "@anvil/core";

/**
 * Phase 25.6 — native `anvil gate` command.
 * Phase 26.2 — `--watch` continuously re-scans the dirty-file diff on a
 * debounce, so slop is surfaced as it appears rather than at turn ends.
 */
export interface NativeGateOptions {
  full?: boolean;
  watch?: boolean;
  /** Scan staged additions only (pre-commit surface) instead of the working tree. */
  staged?: boolean;
  cwd?: string;
}

/** Dirty files only — never a full-tree walk on keystrokes. */
// G12: double quotes — these pathspecs run through a shell, and single quotes
// are not quoting under cmd.exe (shell: true on win32).
const DIFF_PATHSPEC = '-- . ":!node_modules" ":!dist"';

/** Staged additions only — the pre-commit surface (`anvil gate --staged`). */
const STAGED_PATHSPEC =
  'diff --cached --unified=0 --no-color -- . ":(exclude)node_modules" ":(exclude)dist"';

export interface WorkingTreeScan {
  violations: GuardianViolation[];
  error?: string;
  /** Added lines observed by the scan (0 when the diff could not be read). */
  scannedLines?: number;
}

/** Scan the working-tree diff vs HEAD (dirty files only). */
export function scanWorkingTree(cwd: string): WorkingTreeScan {
  return scanGitDiff(cwd, `git diff HEAD ${DIFF_PATHSPEC}`, "(working tree)", true);
}

/**
 * Scan STAGED additions only — what a pre-commit hook would judge. Project-
 * declared `guardian:rules` are enforced here (and in watch mode): in a
 * foreign repo those blocks ARE the ruleset, so the CLI gate and the
 * provisioned hook must agree on them.
 */
export function scanStaged(cwd: string): WorkingTreeScan {
  return scanGitDiff(cwd, `git ${STAGED_PATHSPEC}`, "(staged)", true);
}

function scanGitDiff(cwd: string, command: string, label: string, recordTelemetry: boolean): WorkingTreeScan {
  let diff = "";
  try {
    diff = execSync(command, {
      cwd,
      encoding: "utf8",
      maxBuffer: GATE_DIFF_MAX_BUFFER_BYTES,
      timeout: GATE_DIFF_SCAN_TIMEOUT_MS,
    });
  } catch (err: unknown) {
    return { violations: [], error: `cannot read git diff: ${getErrorMessage(err)}` };
  }
  const scannedLines = diff.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++"))
    .length;
  // Scope by project identity: in a user's own project only the universal rules
  // apply, because the Anvil-specific families name APIs that live here. Project
  // rules apply everywhere — a project that writes a rule means it.
  const violations = scanDiffForSlop(label, diff, detectGuardianScope(cwd), loadCustomGuardianRules(cwd));
  if (recordTelemetry) {
    // 26.5: one observation per real scan. Watch-mode repeats are NOT recorded
    // (they re-scan the same diff, which would inflate the counters); the
    // final watch scan is recorded when the run stops.
    recordHealthScan(cwd, { scannedLines, violations });
  }
  return { violations, scannedLines };
}

/** Honest banner: watch sees the diff vs HEAD only, not the full tree. */
export function formatWatchBanner(cwd: string, opts?: { staged?: boolean }): string {
  const scope = opts?.staged
    ? "Scope: STAGED diff (git diff --cached; node_modules and dist excluded)."
    : "Scope: working-tree diff vs HEAD (dirty files only; node_modules and dist excluded).";
  return (
    `anvil gate --watch — guarding ${cwd}\n` +
    `${scope}\n` +
    "This is NOT full-tree coverage — run `npm run gate` (Step 1.5) for the whole repo.\n" +
    "Watching for changes… (Ctrl+C to stop)\n"
  );
}

/**
 * G8 (AUDIT-2026-09-30): the surface a watch session re-scans. `--staged` used
 * to be silently dropped (watch always scanned the working tree), so a
 * documented mode did nothing. Observed without per-rescan telemetry (the final
 * state is recorded once at stop).
 */
export function watchScan(cwd: string, staged: boolean): WorkingTreeScan {
  const command = staged ? `git ${STAGED_PATHSPEC}` : `git diff HEAD ${DIFF_PATHSPEC}`;
  const label = staged ? "(staged)" : "(working tree)";
  return scanGitDiff(cwd, command, label, false);
}

/**
 * G8 (AUDIT-2026-09-30) — explicit signal ownership.
 *
 * The global SIGTERM/SIGHUP handlers defer their hard exit so an attached
 * runner (e.g. `gate --watch`) can record its final state and exit 0 instead of
 * being pre-empted by `process.exit(143)`. The first cut inferred ownership
 * from `process.listenerCount(signal) > 1`, which is wrong: ANY foreign
 * listener (a library, or the test runner) inflates the count, so the global
 * handler wrongly skipped `exitAltScreen()` + `killAllMcpServers()` and never
 * exited. Ownership is now asserted by the runner itself, so only a genuine
 * Anvil runner can suppress the global handler.
 *
 * SIGINT still uses the entry point's listener-count guard: its consumers
 * (headless/TUI) attach in-process listeners, so the count is reliable there.
 */
const claimedSignals = new Set<NodeJS.Signals>();

/** Signal a runner now owns; the global handler will defer until release. */
export function claimSignal(signal: NodeJS.Signals): void {
  claimedSignals.add(signal);
}

/** Release ownership (e.g. when a watch session stops). */
export function releaseSignal(signal: NodeJS.Signals): void {
  claimedSignals.delete(signal);
}

/** True only when an Anvil runner has explicitly claimed the signal. */
export function isSignalClaimed(signal: NodeJS.Signals): boolean {
  return claimedSignals.has(signal);
}

/**
 * Message for one watch scan, or null to stay silent (a clean tree must not
 * spam the terminal). A clean scan after a dirty one reports the recovery.
 * `scope` names the surface actually scanned so `--staged` cannot claim a
 * working-tree result (or vice versa).
 */
export function watchTransitionMessage(
  previousCount: number,
  scan: WorkingTreeScan,
  scope = "working-tree"
): string | null {
  if (scan.error) return `anvil gate --watch: ${scan.error}\n`;
  if (scan.violations.length === 0) {
    return previousCount > 0 ? `✓ ${scope} diff is clean again.\n` : null;
  }
  const lines = [`⚠ ${scan.violations.length} violation(s) in the ${scope} diff:`];
  for (const v of scan.violations.slice(0, 20)) {
    lines.push(`  ${v.file}:${v.line} [${v.rule}] ${v.detail}`);
  }
  if (scan.violations.length > 20) lines.push(`  … ${scan.violations.length - 20} more`);
  return lines.join("\n") + "\n";
}

export interface Debouncer {
  schedule(): void;
  cancel(): void;
}

/**
 * Coalescing debouncer with a minimum gap between runs (rate bound). Repeated
 * schedule() calls inside the delay window collapse into one run; the min gap
 * keeps a storm of writes from scanning faster than the configured budget.
 */
export function createDebouncer(opts: { delayMs: number; minGapMs: number; onScan: () => void }): Debouncer {
  let timer: NodeJS.Timeout | null = null;
  let lastScan = 0;
  const run = (): void => {
    timer = null;
    const wait = Math.max(0, opts.minGapMs - (Date.now() - lastScan));
    if (wait > 0) {
      timer = setTimeout(run, wait);
      return;
    }
    lastScan = Date.now();
    opts.onScan();
  };
  return {
    schedule(): void {
      if (timer) return; // coalesce bursts into the pending run
      timer = setTimeout(run, opts.delayMs);
    },
    cancel(): void {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}

/** Fast mode (default): in-process guardian scan over the working-tree diff. */
export function runNativeGate(opts: NativeGateOptions): number {
  const cwd = opts.cwd ?? process.cwd();
  if (opts.full) {
    const child = spawnSync("npm", ["run", "gate"], {
      cwd,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    if (child.error) {
      process.stderr.write(`anvil gate --full failed to launch: ${getErrorMessage(child.error)}\n`);
      return 1;
    }
    return child.status ?? 1;
  }

  const scan = opts.staged ? scanStaged(cwd) : scanWorkingTree(cwd);
  if (scan.error) {
    process.stderr.write(`anvil gate: ${scan.error}\n`);
    return 1;
  }
  if (scan.violations.length === 0) {
    process.stdout.write("anvil gate: clean tree — nothing to scan.\n");
    return 0;
  }
  process.stdout.write(`anvil gate: ${scan.violations.length} violation(s):\n`);
  for (const v of scan.violations.slice(0, 50)) {
    process.stdout.write(`  ${v.file}:${v.line} [${v.rule}] ${v.detail}\n`);
  }
  process.stdout.write("Run `npm run gate` for the full pipeline.\n");
  return 1;
}

/**
 * Phase 26.2 — `anvil gate --watch`. Re-scans the dirty-file diff on a debounce
 * until SIGINT/SIGTERM. The active fs watcher keeps the process alive; the
 * returned promise resolves with the exit code when stopped.
 */
export function runNativeGateWatch(opts: NativeGateOptions): Promise<number> {
  const cwd = opts.cwd ?? process.cwd();
  const staged = opts.staged === true;
  process.stdout.write(formatWatchBanner(cwd, { staged }));

  let previousCount = 0;
  let lastScan: WorkingTreeScan | null = null;
  // Watch re-scans the same diff many times per minute; recording every one
  // would inflate the 26.5 counters. Observe silently; record ONCE at stop.
  const scope = staged ? "staged" : "working-tree";
  const runScan = (): void => {
    const scan = watchScan(cwd, staged);
    const message = watchTransitionMessage(previousCount, scan, scope);
    if (message) process.stdout.write(message);
    previousCount = scan.violations.length;
    lastScan = scan;
  };
  runScan();

  const minGapMs = Math.ceil(60_000 / Math.max(1, GUARDIAN_WATCH_MAX_SCANS_PER_MIN));
  const debouncer = createDebouncer({ delayMs: GUARDIAN_WATCH_INTERVAL_MS, minGapMs, onScan: runScan });

  let watcher: fs.FSWatcher;
  try {
    watcher = fs.watch(cwd, { recursive: true }, (_event, filename) => {
      const name = filename ?? "";
      if (name.includes("node_modules") || name.includes(".git") || name.startsWith("dist")) return;
      debouncer.schedule();
    });
  } catch (err: unknown) {
    process.stderr.write(`anvil gate --watch: cannot watch ${cwd}: ${getErrorMessage(err)}\n`);
    return Promise.resolve(1);
  }

  return new Promise<number>((resolve) => {
    const stop = (): void => {
      debouncer.cancel();
      watcher.close();
      releaseSignal("SIGTERM");
      // Record the final observed state once, so watch sessions contribute
      // freshness + a real scan to the health snapshot without per-rescan spam.
      recordHealthScan(cwd, {
        scannedLines: lastScan?.scannedLines ?? 0,
        violations: lastScan?.violations ?? [],
      });
      process.stdout.write("anvil gate --watch: stopped.\n");
      resolve(0);
    };
    // Claim SIGTERM so the entry-point global handler defers to this runner
    // (SIGINT still leans on the entry point's listener-count guard).
    claimSignal("SIGTERM");
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}
