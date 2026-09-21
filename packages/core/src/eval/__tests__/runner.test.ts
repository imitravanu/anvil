import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { loadEvalTasks, runEvalTask, runAllEvalTasks, mapWithConcurrencyLimit, resolveConcurrency } from "../runner.js";
import { createEvalReport, saveEvalReport, loadRecentReports, formatEvalReport, formatTrendComparison } from "../report.js";
import { EvalTask } from "../types.js";

describe("Phase 17 Eval Harness", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-eval-test-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  function createMockTask(taskId: string, shouldPass = true): EvalTask {
    const taskDir = path.join(tmpDir, taskId);
    const setupDir = path.join(taskDir, "setup");
    const assertionsDir = path.join(taskDir, "assertions");
    const expectedDir = path.join(assertionsDir, "expected");

    fs.mkdirSync(setupDir, { recursive: true });
    fs.mkdirSync(expectedDir, { recursive: true });

    // task.json
    fs.writeFileSync(
      path.join(taskDir, "task.json"),
      JSON.stringify({
        name: `Task ${taskId}`,
        category: "bugfix",
        prompt: "Fix the bug in file.txt",
        timeoutMs: 5000,
        fast: true,
      })
    );

    // setup
    fs.writeFileSync(path.join(setupDir, "file.txt"), "initial content");

    // expected
    fs.writeFileSync(path.join(expectedDir, "file.txt"), "expected content");

    // assertions/check.sh
    const checkScript = path.join(assertionsDir, "check.sh");
    if (shouldPass) {
      fs.writeFileSync(
        checkScript,
        `#!/bin/bash
grep -q "expected content" file.txt
exit $?
`
      );
    } else {
      fs.writeFileSync(
        checkScript,
        `#!/bin/bash
echo "Intentional failure"
exit 1
`
      );
    }
    fs.chmodSync(checkScript, 0o755);

    return {
      id: taskId,
      name: `Task ${taskId}`,
      category: "bugfix",
      prompt: "Fix the bug in file.txt",
      timeoutMs: 5000,
      fast: true,
      taskDir,
      setupDir,
      assertionScript: checkScript,
    };
  }

  it("loadEvalTasks discovers valid tasks and ignores invalid directories", () => {
    createMockTask("task-1");
    createMockTask("task-2");

    // Create an invalid directory (no check.sh)
    const invalidDir = path.join(tmpDir, "invalid-task");
    fs.mkdirSync(invalidDir, { recursive: true });
    fs.writeFileSync(path.join(invalidDir, "task.json"), "{}");

    const tasks = loadEvalTasks(tmpDir);
    expect(tasks.length).toBe(2);
    expect(tasks.map((t) => t.id)).toEqual(["task-1", "task-2"]);
  });

  it("runEvalTask passes with mock provider when assertions match", async () => {
    const task = createMockTask("task-pass", true);
    const result = await runEvalTask(task, { useMock: true });

    expect(result.passed).toBe(true);
    expect(result.taskId).toBe("task-pass");
    expect(result.toolCalls).toBe(1);
    expect(result.wallClockMs).toBeGreaterThan(0);
    expect(result.tokensUsed.input).toBeGreaterThan(0);
    expect(result.error).toBeUndefined();
  });

  it("runEvalTask captures failure when assertions fail", async () => {
    const task = createMockTask("task-fail", false);
    const result = await runEvalTask(task, { useMock: true });

    expect(result.passed).toBe(false);
    expect(result.taskId).toBe("task-fail");
    expect(result.error).toContain("Intentional failure");
  });

  it("createEvalReport aggregates results and computes accurate pass rate", () => {
    const results = [
      {
        taskId: "t1",
        name: "Task 1",
        category: "bugfix",
        passed: true,
        wallClockMs: 120,
        tokensUsed: { input: 100, output: 50 },
        toolCalls: 1,
      },
      {
        taskId: "t2",
        name: "Task 2",
        category: "feature",
        passed: false,
        wallClockMs: 150,
        tokensUsed: { input: 150, output: 60 },
        toolCalls: 2,
        error: "check failed",
      },
    ];

    const report = createEvalReport(results, "test-model", "test-provider");
    expect(report.totalTasks).toBe(2);
    expect(report.passedCount).toBe(1);
    expect(report.passRate).toBe(0.5);
    expect(report.totalWallClockMs).toBe(270);
    expect(report.totalTokens.input).toBe(250);
    expect(report.totalTokens.output).toBe(110);
  });

  it("saveEvalReport and loadRecentReports persist and retrieve reports", async () => {
    const results = [
      {
        taskId: "t1",
        name: "Task 1",
        category: "bugfix",
        passed: true,
        wallClockMs: 100,
        tokensUsed: { input: 50, output: 25 },
        toolCalls: 1,
      },
    ];

    const report = createEvalReport(results, "test-model", "test-provider");
    const evalsDir = path.join(tmpDir, "evals-out");
    const savedPath = await saveEvalReport(report, evalsDir);
    expect(fs.existsSync(savedPath)).toBe(true);

    const loaded = loadRecentReports(evalsDir);
    expect(loaded.length).toBe(1);
    expect(loaded[0].model).toBe("test-model");
    expect(loaded[0].passRate).toBe(1.0);
  });

  it("formatEvalReport and formatTrendComparison produce formatted tables", () => {
    const report = createEvalReport(
      [
        {
          taskId: "t1",
          name: "Task 1",
          category: "bugfix",
          passed: true,
          wallClockMs: 100,
          tokensUsed: { input: 50, output: 25 },
          toolCalls: 1,
        },
      ],
      "model-a",
      "mock"
    );

    const formattedReport = formatEvalReport(report);
    expect(formattedReport).toContain("ANVIL EVALUATION REPORT");
    expect(formattedReport).toContain("PASS ✓");

    const trend = formatTrendComparison([report]);
    expect(trend).toContain("ANVIL EVALUATION TREND COMPARISON");
    expect(trend).toContain("mock/model-a");
  });
});

describe("Phase 27.1 parallel execution", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-eval-conc-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // intentional: best-effort temp cleanup; a leftover dir fails nothing
    }
  });

  it("resolveConcurrency clamps garbage into [1, 8] and defaults to 1", () => {
    expect(resolveConcurrency(undefined)).toBe(1);
    expect(resolveConcurrency(4)).toBe(4);
    expect(resolveConcurrency(0)).toBe(1);
    expect(resolveConcurrency(-3)).toBe(1);
    expect(resolveConcurrency(99)).toBe(8);
    expect(resolveConcurrency(2.7)).toBe(2);
    expect(resolveConcurrency(NaN)).toBe(1);
    expect(resolveConcurrency("4")).toBe(4);
  });

  it("mapWithConcurrencyLimit keeps input order under out-of-order completion", async () => {
    // Later indices sleep less, so with limit >= 2 they finish FIRST —
    // the output must still read in input order.
    const items = [0, 1, 2, 3, 4];
    const out = await mapWithConcurrencyLimit(items, 3, async (n) => {
      await new Promise<void>((r) => setTimeout(r, (items.length - n) * 10));
      return `task-${n}`;
    });
    expect(out).toEqual(["task-0", "task-1", "task-2", "task-3", "task-4"]);
  });

  it("mapWithConcurrencyLimit never exceeds the worker bound", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    await mapWithConcurrencyLimit([0, 1, 2, 3, 4, 5], 2, async (n) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise<void>((r) => setTimeout(r, 10));
      inFlight -= 1;
      return n;
    });
    expect(maxInFlight).toBeLessThanOrEqual(2);
    expect(maxInFlight).toBeGreaterThan(1);
  });

  it("mapWithConcurrencyLimit on empty input resolves empty without work", async () => {
    let calls = 0;
    const out = await mapWithConcurrencyLimit([], 4, async () => {
      calls += 1;
      return 1;
    });
    expect(out).toEqual([]);
    expect(calls).toBe(0);
  });

  it("concurrent runAllEvalTasks isolates a failing task and stays ordered", async () => {
    // Reuse the mock-task fixture shape from the Phase 17 block above.
    const mkTask = (taskId: string, shouldPass: boolean): void => {
      const taskDir = path.join(tmpDir, taskId);
      const setupDir = path.join(taskDir, "setup");
      const assertionsDir = path.join(taskDir, "assertions");
      fs.mkdirSync(path.join(setupDir), { recursive: true });
      fs.mkdirSync(path.join(assertionsDir, "expected"), { recursive: true });
      fs.writeFileSync(
        path.join(taskDir, "task.json"),
        JSON.stringify({ name: taskId, category: "bugfix", prompt: "Fix file.txt", fast: true })
      );
      fs.writeFileSync(path.join(setupDir, "file.txt"), "initial content");
      fs.writeFileSync(
        path.join(assertionsDir, "check.sh"),
        shouldPass ? "#!/bin/bash\nexit 0\n" : "#!/bin/bash\necho boom\nexit 1\n"
      );
      fs.chmodSync(path.join(assertionsDir, "check.sh"), 0o755);
    };
    mkTask("c-task-1", true);
    mkTask("c-task-2", false);
    mkTask("c-task-3", true);

    const seenStart = new Set<number>();
    const report = await runAllEvalTasks({
      tasksDir: tmpDir,
      outputDir: path.join(tmpDir, "evals-out"),
      useMock: true,
      concurrency: 3,
      onTaskStart: (_t, index) => {
        seenStart.add(index);
      },
    });

    expect(report.totalTasks).toBe(3);
    expect(report.passedCount).toBe(2);
    // Ordered by task id regardless of which worker finished first, and the
    // failing middle task did not sink its siblings.
    expect(report.results.map((r) => r.taskId)).toEqual(["c-task-1", "c-task-2", "c-task-3"]);
    expect(report.results[1].passed).toBe(false);
    expect(seenStart).toEqual(new Set([1, 2, 3]));
  });
});
