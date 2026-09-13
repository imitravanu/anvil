import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  detectTestCommand,
  extraTestEnvNames,
  runTestVerification,
  runTestTimeoutMs,
  execute,
  definition,
} from "../verifyTests.js";

describe("extraTestEnvNames (ANVIL_TEST_ENV_ALLOW)", () => {
  const KEY = "ANVIL_TEST_ENV_ALLOW";
  const saved = process.env[KEY];

  afterEach(() => {
    if (saved === undefined) delete process.env[KEY];
    else process.env[KEY] = saved;
  });

  it("is empty when unset", () => {
    delete process.env[KEY];
    expect(extraTestEnvNames()).toEqual([]);
  });

  it("parses comma-separated names and rejects shell metachars", () => {
    process.env[KEY] = "DATABASE_URL, NODE_ENV ,BAD;NAME,  ,$(EVIL)";
    expect(extraTestEnvNames()).toEqual(["DATABASE_URL", "NODE_ENV"]);
  });

  it("passes allowed vars through to the test child", async () => {
    process.env[KEY] = "ANVIL_TEST_PASSTHROUGH";
    process.env.ANVIL_TEST_PASSTHROUGH = "hello-child";
    try {
      const result = await runTestVerification(
        process.cwd(),
        "echo \"out:$ANVIL_TEST_PASSTHROUGH\"",
        undefined,
        new AbortController().signal
      );
      expect(result.passed).toBe(true);
      expect(result.output).toContain("out:hello-child");
    } finally {
      delete process.env.ANVIL_TEST_PASSTHROUGH;
    }
  });

  it("does NOT pass through unlisted vars", async () => {
    delete process.env[KEY];
    process.env.ANVIL_TEST_UNLISTED = "should-not-appear";
    try {
      const result = await runTestVerification(
        process.cwd(),
        "echo \"out:${ANVIL_TEST_UNLISTED:-absent}\"",
        undefined,
        new AbortController().signal
      );
      expect(result.output).toContain("out:absent");
    } finally {
      delete process.env.ANVIL_TEST_UNLISTED;
    }
  });
});

describe("runTestTimeoutMs override (ANVIL_RUN_TEST_TIMEOUT_MS)", () => {
  const KEY = "ANVIL_RUN_TEST_TIMEOUT_MS";
  const saved = process.env[KEY];

  afterEach(() => {
    if (saved === undefined) delete process.env[KEY];
    else process.env[KEY] = saved;
  });

  it("defaults to the built-in when unset or non-numeric", () => {
    delete process.env[KEY];
    expect(runTestTimeoutMs()).toBe(60_000);
    process.env[KEY] = "abc";
    expect(runTestTimeoutMs()).toBe(60_000);
  });

  it("clamps hostile values into [1s, 10m]", () => {
    process.env[KEY] = "0";
    expect(runTestTimeoutMs()).toBe(1_000);
    process.env[KEY] = "1e9";
    expect(runTestTimeoutMs()).toBe(600_000);
  });

  it("honors a valid override", () => {
    process.env[KEY] = "30000";
    expect(runTestTimeoutMs()).toBe(30_000);
  });
});

describe("detectTestCommand", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-detect-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("detects npm test in package.json", () => {
    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ scripts: { test: "vitest run" } }),
      "utf8"
    );
    expect(detectTestCommand(tmpDir)).toBe("npm test");
  });

  it("ignores placeholder 'no test specified' in package.json", () => {
    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }),
      "utf8"
    );
    expect(detectTestCommand(tmpDir)).toBeNull();
  });

  it("detects cargo test for Rust projects", () => {
    fs.writeFileSync(path.join(tmpDir, "Cargo.toml"), "[package]\nname = 'demo'", "utf8");
    expect(detectTestCommand(tmpDir)).toBe("cargo test");
  });

  it("detects go test for Go projects", () => {
    fs.writeFileSync(path.join(tmpDir, "go.mod"), "module example.com/demo", "utf8");
    expect(detectTestCommand(tmpDir)).toBe("go test ./...");
  });

  it("detects pytest for Python projects", () => {
    fs.writeFileSync(path.join(tmpDir, "pytest.ini"), "[pytest]", "utf8");
    expect(detectTestCommand(tmpDir)).toBe("pytest");
  });

  it("returns null when no test configuration exists", () => {
    expect(detectTestCommand(tmpDir)).toBeNull();
  });
});

describe("runTestVerification", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-runtest-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("executes a passing command and returns passed=true", async () => {
    const result = await runTestVerification(tmpDir, "echo 'Tests passed!' && exit 0");
    expect(result.passed).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.summary).toContain("All tests passed");
    expect(result.output).toContain("Tests passed!");
    expect(result.failureTrace).toBeUndefined();
  });

  it("executes a failing command and captures failureTrace", async () => {
    const result = await runTestVerification(tmpDir, "echo 'AssertionError: expected 1 to be 2' >&2 && exit 1");
    expect(result.passed).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.summary).toContain("Tests failed (exit 1)");
    expect(result.failureTrace).toContain("AssertionError");
  });
});

describe("runTestVerification pattern safety", () => {
  let tmpDir: string;
  const canary = path.join(os.tmpdir(), "anvil-pattern-canary");

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-pattern-test-"));
    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ scripts: { test: "node --test" } }),
      "utf8"
    );
    try { fs.unlinkSync(canary); } catch { /* absent is fine */ }
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    try { fs.unlinkSync(canary); } catch { /* absent is fine */ }
  });

  it("never executes a model-controlled pattern as shell (regression: injection)", async () => {
    const result = await runTestVerification(tmpDir, "npm test", `x; touch ${canary}`);
    // The pattern is a literal filter argument — the suite runs (no matching
    // tests is fine) but the canary must NOT be created, and the echo of the
    // command shows `npm test -- <pattern>` with the pattern as ONE argument.
    expect(fs.existsSync(canary)).toBe(false);
    expect(result.command).toBe(`npm test -- x; touch ${canary}`);
  });

  it("passes the pattern as a literal argv filter", async () => {
    fs.writeFileSync(
      path.join(tmpDir, "calc.test.js"),
      "import { test } from 'node:test';\nimport assert from 'node:assert';\ntest('pattern probe runs', () => { assert.ok(true); });\n",
      "utf8"
    );
    const result = await runTestVerification(tmpDir, "npm test", "pattern-probe-no-match");
    // Filter matches nothing: node --test exits nonzero, and the filter text
    // arrives as one argv element, not as shell syntax.
    expect(result.passed).toBe(false);
    expect(result.summary).toContain("Tests failed");
  });

  it("refuses patterns for unknown runners instead of shelling out", async () => {
    const result = await runTestVerification(tmpDir, "make check", "x; touch /tmp/nope");
    expect(result.passed).toBe(false);
    expect(result.summary).toContain("unsupported runner");
  });
});

describe("verify_tests tool executor", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-tool-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("has non-mutating tool definition", () => {
    expect(definition.name).toBe("verify_tests");
    expect(definition.mutating).toBe(false);
  });

  it("returns error when no test runner detected", async () => {
    const result = await execute({}, {
      projectRoot: tmpDir,
      signal: new AbortController().signal,
    });
    expect(result.isError).toBe(true);
    expect(result.summary).toBe("No test runner detected");
  });

  it("runs detected tests and returns tool execution result", async () => {
    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ scripts: { test: "echo 'ok' && exit 0" } }),
      "utf8"
    );

    const result = await execute({}, {
      projectRoot: tmpDir,
      signal: new AbortController().signal,
    });

    expect(result.isError).toBe(false);
    expect(result.summary).toContain("All tests passed");
  });
});

describe("argvWithPattern flag injection prevention (Phase 21.3)", () => {
  it("rejects patterns that look like flags or contain null bytes", async () => {
    const { argvWithPattern, runTestVerification } = await import("../verifyTests.js");
    expect(argvWithPattern("pytest", "--pastebin")).toBeNull();
    expect(argvWithPattern("cargo test", "-j1")).toBeNull();
    expect(argvWithPattern("pytest", "test_login")).toEqual(["pytest", "test_login"]);
    expect(argvWithPattern("npm test", "my-pattern")).toEqual(["npm", "test", "--", "my-pattern"]);

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-flag-injection-"));
    try {
      const result = await runTestVerification(tmp, "pytest", "--pastebin");
      expect(result.passed).toBe(false);
      expect(result.summary).toContain("unsupported runner");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

