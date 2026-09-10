import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { loadEvalTasks, runEvalTask, runAllEvalTasks } from "../runner.js";
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
