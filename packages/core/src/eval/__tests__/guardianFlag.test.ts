import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { runEvalTask, runAllEvalTasks, loadEvalTasks } from "../runner.js";
import { createEvalReport, formatGuardianDelta } from "../report.js";
import { findGuardianDeltaPair } from "../delta.js";
import type { EvalResult, EvalReport, EvalTask } from "../types.js";

function result(taskId: string, passed: boolean): EvalResult {
  return {
    taskId,
    name: taskId,
    category: "feature",
    passed,
    wallClockMs: 100,
    tokensUsed: { input: 10, output: 5 },
    toolCalls: 1,
  };
}

function reportOf(guardian: boolean, passRate: number): EvalReport {
  const results = [result("t1", passRate >= 0.5)];
  const rep = createEvalReport(results, "m", "p", guardian);
  return { ...rep, passRate };
}

function makeMockTask(taskId: string, tmpDir: string): EvalTask {
  const taskDir = path.join(tmpDir, taskId);
  const setupDir = path.join(taskDir, "setup");
  const assertionsDir = path.join(taskDir, "assertions");
  const expectedDir = path.join(assertionsDir, "expected");

  fs.mkdirSync(setupDir, { recursive: true });
  fs.mkdirSync(expectedDir, { recursive: true });
  fs.writeFileSync(path.join(taskDir, "task.json"), JSON.stringify({
    name: `Task ${taskId}`,
    category: "bugfix",
    prompt: "Fix the bug",
    timeoutMs: 5000,
    fast: true,
  }));
  fs.writeFileSync(path.join(setupDir, "file.txt"), "initial content");
  fs.writeFileSync(path.join(expectedDir, "file.txt"), "expected content");
  const checkScript = path.join(assertionsDir, "check.sh");
  fs.writeFileSync(checkScript, `#!/bin/bash\ngrep -q "expected content" file.txt\nexit $?\n`);
  fs.chmodSync(checkScript, 0o755);

  return {
    id: taskId,
    name: `Task ${taskId}`,
    category: "bugfix",
    prompt: "Fix the bug",
    timeoutMs: 5000,
    fast: true,
    taskDir,
    setupDir,
    assertionScript: checkScript,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("26.3 guardian flag — report layer", () => {
  it("records the guardian mode on the report; unset defaults to ON", () => {
    expect(createEvalReport([result("t1", true)], "m", "p", false).guardian).toBe(false);
    expect(createEvalReport([result("t1", true)], "m", "p", true).guardian).toBe(true);
    // Legacy/unset — never claims OFF, the product default is ON.
    expect(createEvalReport([result("t1", true)], "m", "p").guardian).toBe(true);
  });

  it("formatGuardianDelta renders an honest null result when a half is missing", () => {
    const out = formatGuardianDelta(reportOf(true, 0.8), undefined);
    expect(out).toContain("Delta unavailable");
    expect(out).toContain("(missing)");
  });

  it("formatGuardianDelta renders the delta table when both halves exist", () => {
    const on = reportOf(true, 0.8);
    const off = reportOf(false, 0.4);
    const out = formatGuardianDelta(on, off);
    expect(out).toContain("GUARDIAN DELTA");
    expect(out).toContain("80.0%");
    expect(out).toContain("40.0%");
    expect(out).toContain("40.0 pts");
    expect(out).toContain("guardian helps");
    expect(out).toContain("t1");
  });

  it("a zero delta is reported as no delta — no manufactured wins", () => {
    const out = formatGuardianDelta(reportOf(true, 0.6), reportOf(false, 0.6));
    expect(out).toContain("no delta");
  });

  it("a negative delta is reported as guardian hurts — honesty over marketing", () => {
    const out = formatGuardianDelta(reportOf(true, 0.2), reportOf(false, 0.6));
    expect(out).toContain("guardian hurts");
  });
});

describe("26.3 guardian flag — pairing", () => {
  it("finds the newest ON and OFF reports and ignores legacy fieldless ones", () => {
    const legacy = { ...reportOf(undefined as unknown as boolean, 0.5), guardian: undefined } as EvalReport;
    const oldOn = { ...reportOf(true, 0.5), timestamp: 100 };
    const newOn = { ...reportOf(true, 0.9), timestamp: 300 };
    const off = { ...reportOf(false, 0.3), timestamp: 200 };
    const { on, off: foundOff } = findGuardianDeltaPair([legacy, oldOn, off, newOn]);
    expect(on?.timestamp).toBe(300);
    expect(foundOff?.timestamp).toBe(200);
  });

  it("ignores all-zero-token reports — a 429-dead lane must not fake a delta", () => {
    // The ON lane never reached the provider (every task 0 tokens): pairing it
    // against a real OFF lane would render "guardian destroyed the pass rate"
    // out of a rate-limit outage.
    const deadOn = {
      ...reportOf(true, 0),
      timestamp: 500,
      results: [result("t1", false), result("t2", false)].map((r) => ({
        ...r,
        tokensUsed: { input: 0, output: 0 },
      })),
    };
    const liveOff = { ...reportOf(false, 0.4), timestamp: 400 };
    const { on, off } = findGuardianDeltaPair([deadOn, liveOff]);
    expect(on).toBeUndefined();
    expect(off?.timestamp).toBe(400);
  });

  it("a half-alive report (most tasks 429) is also unpairsble", () => {
    // 9 of 10 tasks dead: the one live task cannot represent the run.
    const results = Array.from({ length: 10 }, (_, i) => result(`t${i}`, false));
    results[0].tokensUsed = { input: 10, output: 5 }; // only task 0 alive
    const mostlyDeadOn = { ...reportOf(true, 0), timestamp: 500, results };
    const liveOff = { ...reportOf(false, 0.4), timestamp: 400 };
    const { on } = findGuardianDeltaPair([mostlyDeadOn, liveOff]);
    expect(on).toBeUndefined();
  });

  it("a mismatched task set (1-task probe vs 15-task run) is not a delta", () => {
    const off = { ...reportOf(false, 0.4), timestamp: 400, results: [result("t1", true), result("t2", false)] };
    const onProbe = { ...reportOf(true, 1), timestamp: 500, results: [result("t1", true)] };
    const { on, off: foundOff } = findGuardianDeltaPair([onProbe, off]);
    expect(foundOff?.timestamp).toBe(400);
    expect(on).toBeUndefined();
  });

  it("filters by provider/model when given", () => {
    const onA = { ...reportOf(true, 0.9), provider: "alpha", timestamp: 300 };
    const offA = { ...reportOf(false, 0.3), provider: "alpha", timestamp: 200 };
    // A complete beta pair (both halves, same task set).
    const onB = { ...reportOf(true, 0.5), provider: "beta", timestamp: 400 };
    const offB = { ...reportOf(false, 0.3), provider: "beta", timestamp: 350 };
    const pair = findGuardianDeltaPair([onA, offA, onB, offB], { provider: "beta" });
    expect(pair.on?.provider).toBe("beta");
    expect(pair.off?.provider).toBe("beta");
    // A provider with no reports at all yields nothing — no leakage.
    const none = findGuardianDeltaPair([onA, offA, onB, offB], { provider: "gamma" });
    expect(none.on).toBeUndefined();
    expect(none.off).toBeUndefined();
  });
});

describe("26.3 guardian flag — runner seeding and pacing", () => {
  it("runAllEvalTasks seeds the guardian toggle into each task session and records it", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-eval-gtoggle-"));
    try {
      const task = makeMockTask("gtoggle-seed", tmpDir);
      const report = await runAllEvalTasks({
        tasksDir: tmpDir,
        useMock: true,
        guardian: false,
      });
      expect(report.guardian).toBe(false);
      expect(report.totalTasks).toBe(1);
      expect(report.results[0].taskId).toBe(task.id);
      expect(report.results[0].passed).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("default run keeps guardian ON without touching session behavior", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-eval-gdefault-"));
    try {
      makeMockTask("gtoggle-default", tmpDir);
      const report = await runAllEvalTasks({ tasksDir: tmpDir, useMock: true });
      expect(report.guardian).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("betweenTaskDelayMs sleeps between tasks but never after the last one", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-eval-gdelay-"));
    try {
      makeMockTask("delay-a", tmpDir);
      makeMockTask("delay-b", tmpDir);
      const tasks = loadEvalTasks(tmpDir);
      expect(tasks.length).toBe(2);

      const sleepSpy = vi.spyOn(global, "setTimeout");
      const t0 = Date.now();
      await runAllEvalTasks({ tasksDir: tmpDir, useMock: true, betweenTaskDelayMs: 150 });
      const elapsed = Date.now() - t0;

      // Exactly one inter-task gap of ~150ms — not two.
      expect(elapsed).toBeGreaterThanOrEqual(140);
      expect(elapsed).toBeLessThan(600);
      // setTimeout was called once for the delay (vitest internals aside, our
      // own pacing call is the only one with 150 as its argument).
      expect(sleepSpy.mock.calls.filter(([, ms]) => ms === 150).length).toBe(1);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("runEvalTask honors the guardian toggle end-to-end (smoke)", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-eval-gtask-"));
    try {
      const task = makeMockTask("gtoggle-task", tmpDir);
      const off = await runEvalTask(task, { useMock: true, guardian: false });
      expect(off.passed).toBe(true);
      const on = await runEvalTask(task, { useMock: true, guardian: true });
      expect(on.passed).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
