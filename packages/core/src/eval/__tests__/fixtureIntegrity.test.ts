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
