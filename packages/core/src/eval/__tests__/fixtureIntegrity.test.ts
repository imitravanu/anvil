import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * Eval fixture integrity (Phase 27.2 / 27.4 guard).
 *
 * A benchmark task is only meaningful if it is RED while its own `setup/` is
 * still broken. The mock provider copies `assertions/expected/` into the
 * sandbox and ends the turn, so a task whose assertion also succeeds against the
 * untouched `setup/` inflates every eval run's pass rate while measuring
 * nothing — and, because mock mode is green "by construction", nothing else in
 * the pipeline would ever notice.
 *
 * Both directions therefore matter, and only one of them is checked elsewhere:
 * gate Step 5 runs the suite in mock mode (proving each fixture goes GREEN with
 * its reference fix), and this suite proves each fixture is RED without it.
 *
 * Environment honesty: if an interpreter a fixture needs is missing (say
 * `python3`), that fixture's `check.sh` exits non-zero on its own, which this
 * suite reads as "red" — a weaker signal, not a failure. The positive direction
 * lives in the mock run, so a missing interpreter surfaces there as a hard gate
 * failure rather than passing silently here.
 */
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
const TASKS_DIR = path.join(REPO_ROOT, "evals", "tasks");

/** Every task directory, in the same stable order `loadEvalTasks` uses. */
function listTaskDirs(): string[] {
  return fs
    .readdirSync(TASKS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function copyDirRecursive(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(from, to);
    } else {
      fs.copyFileSync(from, to);
    }
  }
}

/**
 * Mirrors the sandbox environment `runEvalTask` builds, so a fixture is judged
 * against the same (deliberately narrow) world in both places.
 */
function sandboxEnv(tempDir: string): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    LANG: process.env.LANG ?? "",
    USER: process.env.USER ?? "",
    LOGNAME: process.env.LOGNAME ?? "",
    TMPDIR: process.env.TMPDIR ?? "",
    SHELL: process.env.SHELL ?? "",
    PROJECT_ROOT: tempDir,
  };
}

function countFiles(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      total += countFiles(path.join(dir, entry.name));
    } else {
      total += 1;
    }
  }
  return total;
}

/**
 * Phase 39 A4 — the harder tier (`evals/tasks-hard`).
 *
 * gate Step 5 runs the mock lane over `evals/tasks` only, so this directory gets
 * no coverage there: a fixture could rot (lose its guard, stop being RED, gain a
 * check that no solution satisfies) with the whole pipeline still green. The
 * tier is the measurement carrier for prompt work, so it is pinned here in BOTH
 * directions instead:
 *
 *   RED   — against its pristine `setup/` (the pre-fix state must fail)
 *   GREEN — against `setup/` overlaid with `assertions/expected/` (the coherent
 *           solution must satisfy the suite AND the structural guards)
 *
 * The GREEN half is what makes a harder-tier task meaningful: its guards assert
 * properties the test suite alone cannot see (one formatting rule, duplication
 * actually removed, no legacy key, a single constant source), so "tests pass" is
 * explicitly not a pass. Those receipts were run by hand when the tier was
 * authored (2026-10-04); this suite is what keeps them true afterwards.
 */
const HARD_TASKS_DIR = path.join(REPO_ROOT, "evals", "tasks-hard");

function listHardTaskDirs(): string[] {
  if (!fs.existsSync(HARD_TASKS_DIR)) return [];
  return fs
    .readdirSync(HARD_TASKS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function runCheckIn(taskDir: string, overlay: string | null, probe?: string): number | null {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-hard-fixture-"));
  const checkSh = path.join(taskDir, "assertions", "check.sh");
  try {
    copyDirRecursive(path.join(taskDir, "setup"), tempDir);
    if (overlay) copyDirRecursive(overlay, tempDir);
    if (probe) copyDirRecursive(probe, tempDir);
    try {
      fs.chmodSync(checkSh, 0o755);
    } catch {
      // intentional: chmod is best-effort — a missing exec bit surfaces in the
      // spawn below as a real error, exactly as it does in runEvalTask
    }
    const result = spawnSync("bash", [checkSh], {
      cwd: tempDir,
      timeout: 60_000,
      env: sandboxEnv(tempDir),
      stdio: ["ignore", "pipe", "pipe"],
    });
    return result.status;
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

describe("Harder-tier fixture integrity (A4)", () => {
  const hardDirs = listHardTaskDirs();

  it("discovers the harder tier", () => {
    expect(hardDirs.length).toBeGreaterThanOrEqual(6);
    expect(hardDirs).toContain("01-contract-propagation");
    expect(hardDirs).toContain("06-untested-symptom");
  });

  it("gives every harder fixture the structure the harness requires", () => {
    const problems: string[] = [];
    for (const dir of hardDirs) {
      const taskDir = path.join(HARD_TASKS_DIR, dir);
      const configPath = path.join(taskDir, "task.json");
      if (!fs.existsSync(configPath)) {
        problems.push(`${dir}: missing task.json`);
        continue;
      }
      if (countFiles(path.join(taskDir, "setup")) === 0) {
        problems.push(`${dir}: setup/ is missing or empty`);
      }
      if (!fs.existsSync(path.join(taskDir, "assertions", "check.sh"))) {
        problems.push(`${dir}: missing assertions/check.sh`);
      }
      if (countFiles(path.join(taskDir, "assertions", "expected")) === 0) {
        problems.push(`${dir}: assertions/expected/ is missing or empty`);
      }
      try {
        const config = JSON.parse(fs.readFileSync(configPath, "utf8")) as Record<string, unknown>;
        for (const field of ["name", "category", "prompt"]) {
          const value = config[field];
          if (typeof value !== "string" || value.trim().length === 0) {
            problems.push(`${dir}: task.json "${field}" must be a non-empty string`);
          }
        }
        // A harder task that runs instantly is not a long-horizon task.
        if (typeof config.timeoutMs !== "number" || config.timeoutMs < 60_000) {
          problems.push(`${dir}: task.json "timeoutMs" must be >= 60000 for the harder tier`);
        }
      } catch {
        problems.push(`${dir}: task.json is not valid JSON`);
      }
    }
    expect(problems).toEqual([]);
  });

  it(
    "is RED against every pristine setup and GREEN with its reference solution",
    () => {
      const problems: string[] = [];
      for (const dir of hardDirs) {
        const taskDir = path.join(HARD_TASKS_DIR, dir);
        if (!fs.existsSync(path.join(taskDir, "assertions", "check.sh"))) continue;

        const red = runCheckIn(taskDir, null);
        if (red === 0) problems.push(`${dir}: passes without its fix (not a task)`);

        const green = runCheckIn(taskDir, path.join(taskDir, "assertions", "expected"));
        if (green !== 0) {
          problems.push(
            `${dir}: the reference solution does not satisfy the guard (exit ${green}) — ` +
              `either the guard over-reaches or expected/ drifted from setup/`
          );
        }
      }
      expect(problems).toEqual([]);
    },
    300_000
  );

  it(
    "every declared structural guard still BITES (a removed guard fails the gate)",
    () => {
      // RED/GREEN alone cannot see a downgrade: `setup/` still fails without the
      // fix and still passes with it if someone deletes the extra guard block
      // from check.sh — the task quietly becomes "make the suite green", which is
      // exactly what the harder tier exists to refuse. (Observed for real: a
      // concurrent session's uncommitted edit stripped 01's one-formatting-rule
      // block on 2026-10-04.) A `guard-probe/` overlay satisfies every assertion
      // while violating the structural rule, so it must be RED. Remove the guard
      // and the probe passes — this assertion fails instead of the guard
      // disappearing.
      const problems: string[] = [];
      let probes = 0;
      for (const dir of hardDirs) {
        const taskDir = path.join(HARD_TASKS_DIR, dir);
        const probeDir = path.join(taskDir, "assertions", "guard-probe");
        if (!fs.existsSync(probeDir)) continue;
        probes += 1;
        const status = runCheckIn(taskDir, path.join(taskDir, "assertions", "expected"), probeDir);
        if (status === 0) {
          problems.push(
            `${dir}: the guard-probe passes — the structural guard is gone or no longer bites`
          );
        }
      }
      // A floor, so a mass deletion of probes is itself a failure. Four tasks
      // carry structural guards (01/03/04/05); 02 and 06 are guarded by the
      // suite itself, which the RED check above already proves bites.
      expect(probes).toBeGreaterThanOrEqual(4);
      expect(problems).toEqual([]);
    },
    300_000
  );
});

describe("Eval fixture integrity", () => {
  const taskDirs = listTaskDirs();

  it("discovers the full benchmark suite", () => {
    // Phase 27's target: 15 original tasks plus the 5 language fixtures and 5
    // diagnostics added in 27.2 / 27.4.
    expect(taskDirs.length).toBeGreaterThanOrEqual(25);
    expect(taskDirs).toContain("16-feature-ts-generics");
    expect(taskDirs).toContain("25-diagnose-multifile-contract");
  });

  it("gives every fixture the structure the harness requires", () => {
    const problems: string[] = [];

    for (const dir of taskDirs) {
      const taskDir = path.join(TASKS_DIR, dir);
      const configPath = path.join(taskDir, "task.json");
      const setupDir = path.join(taskDir, "setup");
      const checkSh = path.join(taskDir, "assertions", "check.sh");
      const expectedDir = path.join(taskDir, "assertions", "expected");

      // loadEvalTasks only picks a directory up as a task when all three exist.
      if (!fs.existsSync(configPath)) {
        problems.push(`${dir}: missing task.json`);
        continue;
      }
      if (countFiles(setupDir) === 0) problems.push(`${dir}: setup/ is missing or empty`);
      if (!fs.existsSync(checkSh)) problems.push(`${dir}: missing assertions/check.sh`);
      if (countFiles(expectedDir) === 0) {
        problems.push(`${dir}: assertions/expected/ is missing or empty (offline mock mode)`);
      }

      let config: Record<string, unknown>;
      try {
        config = JSON.parse(fs.readFileSync(configPath, "utf8"));
      } catch {
        problems.push(`${dir}: task.json is not valid JSON`);
        continue;
      }

      for (const field of ["name", "category", "prompt"]) {
        const value = config[field];
        if (typeof value !== "string" || value.trim().length === 0) {
          problems.push(`${dir}: task.json "${field}" must be a non-empty string`);
        }
      }
      if (typeof config.fast !== "boolean") {
        problems.push(`${dir}: task.json "fast" must be a boolean`);
      }
    }

    expect(problems).toEqual([]);
  });

  it(
    "is RED on every pristine setup (no fixture passes without its fix)",
    () => {
      const passedWithoutAFix: string[] = [];

      for (const dir of taskDirs) {
        const taskDir = path.join(TASKS_DIR, dir);
        const checkSh = path.join(taskDir, "assertions", "check.sh");
        if (!fs.existsSync(checkSh)) continue;

        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `anvil-fixture-${dir}-`));
        try {
          copyDirRecursive(path.join(taskDir, "setup"), tempDir);

          try {
            fs.chmodSync(checkSh, 0o755);
          } catch {
            // intentional: chmod is best-effort — a missing exec bit surfaces in
            // the spawn below as a real error, exactly as it does in runEvalTask
          }

          const result = spawnSync("bash", [checkSh], {
            cwd: tempDir,
            timeout: 10_000,
            env: sandboxEnv(tempDir),
            stdio: ["ignore", "pipe", "pipe"],
          });

          if (result.status === 0) passedWithoutAFix.push(dir);
        } finally {
          fs.rmSync(tempDir, { recursive: true, force: true });
        }
      }

      // One aggregate assertion, so a regression reports every affected fixture
      // instead of stopping at the first one.
      expect(passedWithoutAFix).toEqual([]);
    },
    300_000
  );
});
