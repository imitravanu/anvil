import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { ToolContext, ToolDefinition, ToolExecutor, ToolExecutionResult } from "./types.js";
import { resolveWithinRoot } from "./paths.js";

export const RUN_TEST_TIMEOUT_MS = 60_000;
export const MAX_TEST_OUTPUT_BYTES = 30 * 1024;

// Sanity bounds for the env override — a hostile value must not busy-freeze
// the turn (`0`) nor park it for an hour (huge values).
const MIN_TEST_TIMEOUT_MS = 1_000;
const MAX_TEST_TIMEOUT_MS = 600_000;

/**
 * Test-runner timeout in ms, overridable via ANVIL_RUN_TEST_TIMEOUT_MS and
 * clamped to [1s, 10m]. Unset or non-finite → the built-in default.
 */
export function runTestTimeoutMs(): number {
  const raw = Number(process.env.ANVIL_RUN_TEST_TIMEOUT_MS);
  if (!Number.isFinite(raw)) return RUN_TEST_TIMEOUT_MS;
  return Math.min(Math.max(Math.round(raw), MIN_TEST_TIMEOUT_MS), MAX_TEST_TIMEOUT_MS);
}

export interface TestRunResult {
  passed: boolean;
  exitCode: number;
  command: string;
  summary: string;
  output: string;
  failureTrace?: string;
}

/**
 * Detect the project's test command by inspecting workspace files.
 */
export function detectTestCommand(projectRoot: string): string | null {
  try {
    const pkgPath = path.join(projectRoot, "package.json");
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      const testScript = pkg?.scripts?.test;
      if (
        typeof testScript === "string" &&
        testScript.trim().length > 0 &&
        !testScript.includes("no test specified")
      ) {
        return "npm test";
      }
    }

    if (fs.existsSync(path.join(projectRoot, "Cargo.toml"))) {
      return "cargo test";
    }

    if (fs.existsSync(path.join(projectRoot, "go.mod"))) {
      return "go test ./...";
    }

    if (
      fs.existsSync(path.join(projectRoot, "pytest.ini")) ||
      fs.existsSync(path.join(projectRoot, "pyproject.toml")) ||
      fs.existsSync(path.join(projectRoot, "setup.cfg"))
    ) {
      return "pytest";
    }
  } catch {
    // ignore parse errors
  }

  return null;
}

/**
 * The pattern supplied by the model reaches the runner as a separate argv
 * element (no shell, no interpolation) — a pattern like "x; touch /tmp/p"
 * is a literal test filter that fails to match, not a second command.
 */
function argvWithPattern(baseCommand: string, pattern: string): string[] | null {
  const words = baseCommand.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  const [bin, ...rest] = words;
  switch (bin) {
    case "npm":
      return ["npm", ...rest, "--", pattern];
    case "cargo":
      return ["cargo", ...rest, pattern];
    case "pytest":
      return ["pytest", ...rest, pattern];
    case "go":
      // `go test ./...` → `go test -run <pattern> ./...`
      return ["go", ...rest.slice(0, 1), "-run", pattern, ...rest.slice(1)];
    default:
      // Unknown runner: refuse rather than fall back to a shell.
      return null;
  }
}

/**
 * Extra env vars to pass through to the test child, beyond the scrubbed
 * base. Suites needing DATABASE_URL, NODE_ENV=test, API keys, etc. failed
 * spuriously under auto-verify (burning repair loops on good code).
 * Opt-in via ANVIL_TEST_ENV_ALLOW="DATABASE_URL,NODE_ENV,API_KEY" — never
 * inherited implicitly, so credentials still don't leak by default.
 */
export function extraTestEnvNames(): string[] {
  return (process.env.ANVIL_TEST_ENV_ALLOW ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(s));
}

function childEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: process.env.HOME,
    LANG: process.env.LANG ?? "C.UTF-8",
    NO_COLOR: "1",
    CI: "1",
  };
  for (const name of extraTestEnvNames()) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  return env;
}

/**
 * Execute the test command. When a pattern is given the runner is spawned
 * directly (argv array, pattern as its own argument) so model-controlled
 * filter text can never execute as a shell command. Without a pattern the
 * command is run through the shell as configured — it comes from project
 * config or the user's `autoVerify` setting, not from the model.
 */
export async function runTestVerification(
  projectRoot: string,
  baseCommand: string,
  pattern?: string,
  signal?: AbortSignal
): Promise<TestRunResult> {
  const patternArgv = pattern ? argvWithPattern(baseCommand, pattern) : null;
  if (pattern && !patternArgv) {
    return {
      passed: false,
      exitCode: 1,
      command: baseCommand,
      summary: `Cannot pass a test pattern to "${baseCommand}" safely — unsupported runner`,
      output: "",
      failureTrace: "Pattern filtering is only supported for npm, cargo, pytest, and go runners.",
    };
  }
  // Windows: npm is a .cmd shim, which Node refuses to spawn without a shell —
  // and a shell would reintroduce the injection this function exists to prevent.
  if (patternArgv && process.platform === "win32" && patternArgv[0] === "npm") {
    return {
      passed: false,
      exitCode: 1,
      command: baseCommand,
      summary: "npm pattern filtering is unsupported on Windows — run verify_tests without a pattern",
      output: "",
      failureTrace: undefined,
    };
  }

  const useArgv = patternArgv !== null;
  // Trusted command (project config / user setting): through the shell.
  // Model-supplied pattern: direct argv spawn, pattern as its own argument.
  const spawnSpec = useArgv
    ? { file: patternArgv![0], args: patternArgv!.slice(1), fullCommand: patternArgv!.join(" ") }
    : { file: baseCommand, args: [] as string[], fullCommand: baseCommand };

  return new Promise((resolve) => {
    const child = spawn(spawnSpec.file, spawnSpec.args, {
      cwd: projectRoot,
      detached: true,
      shell: !useArgv,
      env: childEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });

    const fullCommand = spawnSpec.fullCommand;

    const chunks: Buffer[] = [];
    let totalBytes = 0;

    const onData = (chunk: Buffer) => {
      if (totalBytes < MAX_TEST_OUTPUT_BYTES) {
        const room = MAX_TEST_OUTPUT_BYTES - totalBytes;
        const slice = chunk.length > room ? chunk.subarray(0, room) : chunk;
        chunks.push(slice);
        totalBytes += slice.length;
      }
    };

    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);

    const killTree = () => {
      try {
        if (child.pid != null) process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    };

    let timedOut = false;
    const timeoutMs = runTestTimeoutMs();
    const timer = setTimeout(() => {
      timedOut = true;
      killTree();
    }, timeoutMs);

    const onAbort = () => killTree();
    if (signal?.aborted) onAbort();
    signal?.addEventListener("abort", onAbort, { once: true });

    child.on("error", (err) => {
      signal?.removeEventListener("abort", onAbort);
      clearTimeout(timer);
      resolve({
        passed: false,
        exitCode: 1,
        command: fullCommand,
        summary: `Failed to spawn tests: ${err.message}`,
        output: err.message,
        failureTrace: err.message,
      });
    });

    child.on("close", (code) => {
      signal?.removeEventListener("abort", onAbort);
      clearTimeout(timer);

      const rawOutput = Buffer.concat(chunks).toString("utf8");
      const passed = code === 0 && !timedOut && !(signal?.aborted);

      let summary: string;
      if (signal?.aborted) {
        summary = `Tests cancelled: ${fullCommand}`;
      } else if (timedOut) {
        summary = `Tests timed out after ${timeoutMs}ms: ${fullCommand}`;
      } else if (passed) {
        summary = `All tests passed: ${fullCommand}`;
      } else {
        summary = `Tests failed (exit ${code}): ${fullCommand}`;
      }

      resolve({
        passed,
        exitCode: code ?? 1,
        command: fullCommand,
        summary,
        output: rawOutput,
        failureTrace: passed ? undefined : rawOutput.slice(-4000), // retain last 4KB failure trace
      });
    });
  });
}

export const definition: ToolDefinition = {
  name: "verify_tests",
  description:
    "Run the project test suite or a targeted test pattern to verify regressions. " +
    "Automatically discovers the test runner (npm test, cargo test, pytest, go test). Non-mutating.",
  inputSchema: {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description:
          "Optional test pattern or file filter (e.g. 'rules.test.ts'). " +
          "Passed to the runner as a literal filter argument — never interpreted by a shell.",
      },
    },
  },
  mutating: false,
};

export const execute: ToolExecutor = async (input, ctx: ToolContext): Promise<ToolExecutionResult> => {
  const pattern = (input as { pattern?: string })?.pattern;
  const cmd = detectTestCommand(ctx.projectRoot);

  if (!cmd) {
    return {
      output: {
        error: "No test runner could be detected for this project. Check package.json, Cargo.toml, or pytest configuration.",
      },
      isError: true,
      summary: "No test runner detected",
    };
  }

  const result = await runTestVerification(ctx.projectRoot, cmd, pattern, ctx.signal);

  return {
    output: {
      passed: result.passed,
      command: result.command,
      exitCode: result.exitCode,
      summary: result.summary,
      output: result.output,
      failureTrace: result.failureTrace,
    },
    isError: !result.passed,
    summary: result.summary,
  };
};
