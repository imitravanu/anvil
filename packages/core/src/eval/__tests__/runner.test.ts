import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { loadEvalTasks, runEvalTask, runAllEvalTasks, mapWithConcurrencyLimit, resolveConcurrency } from "../runner.js";
import { createEvalReport, saveEvalReport, loadRecentReports, formatEvalReport, formatTrendComparison } from "../report.js";
import type { EvalRunnerOptions, EvalTask } from "../types.js";

describe("Phase 17 Eval Harness", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-eval-test-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // intentional: best-effort temp cleanup — a leftover dir never fails a test.
    }
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

  it("records cached input as a BREAKDOWN of input, never on top of it", async () => {
    // Prompt caching (38.7) means most of an eval run's input is a cache read.
    // The usage event reports it as a breakdown of `inputTokens`; the result
    // must keep that relationship so pricing can discount it (and the report
    // can show it) without double-counting the tokens.
    const cacheProvider = {
      id: "openai",
      displayName: "cache scripted",
      isConfigured: () => true,
      async *streamCompletion() {
        yield { type: "usage" as const, inputTokens: 1_000, outputTokens: 50, cachedInputTokens: 800, cacheCreationInputTokens: 100 };
        yield { type: "turn_end" as const, stopReason: "end_turn" as const };
      },
    };
    const task = createMockTask("task-cache", true);
    fs.writeFileSync(task.assertionScript, "#!/bin/bash\nexit 0\n");
    fs.chmodSync(task.assertionScript, 0o755);
    const provider = cacheProvider as unknown as NonNullable<EvalRunnerOptions["provider"]>;

    const result = await runEvalTask(task, { provider });
    expect(result.tokensUsed.input).toBe(1_000);
    expect(result.tokensUsed.output).toBe(50);
    expect(result.tokensUsed.cachedInput).toBe(800);
    expect(result.tokensUsed.cacheCreationInput).toBe(100);
  });

  // Takeover 2026-10-10 (A8 done at the source): the provider classifies its
  // own deaths and turnStream now carries that origin on the error event.
  // Before, a provider-killed run fell through to check.sh, failed it, and was
  // graded "task" — an outage was recorded as "the model is bad at coding", and
  // the A/B harness counted it as capability evidence. RED first: both rows
  // returned failureKind "task" against the pre-change runner.
  it("grades a provider-killed run as provider weather, not capability", async () => {
    const deadProvider = {
      id: "openai",
      displayName: "dead scripted",
      isConfigured: () => true,
      async *streamCompletion() {
        yield {
          type: "error" as const,
          message: "HTTP 500: upstream exploded",
          code: "SERVER_OVERLOADED" as const,
          isRetryable: false,
        };
      },
    };
    const task = createMockTask("task-provider-death", true);
    fs.writeFileSync(task.assertionScript, "#!/bin/bash\nexit 1\n");
    fs.chmodSync(task.assertionScript, 0o755);
    const provider = deadProvider as unknown as NonNullable<EvalRunnerOptions["provider"]>;

    const result = await runEvalTask(task, { provider });
    expect(result.passed).toBe(false);
    expect(result.failureKind, "a 5xx outage is not a capability failure").toBe("provider");
  });

  it("grades a network death as network, distinctly from other provider weather", async () => {
    const unreachableProvider = {
      id: "openai",
      displayName: "unreachable scripted",
      isConfigured: () => true,
      async *streamCompletion() {
        yield {
          type: "error" as const,
          message: "fetch failed: ECONNRESET",
          code: "NETWORK_TIMEOUT" as const,
          isRetryable: true,
        };
      },
    };
    const task = createMockTask("task-network-death", true);
    fs.writeFileSync(task.assertionScript, "#!/bin/bash\nexit 1\n");
    fs.chmodSync(task.assertionScript, 0o755);
    const provider = unreachableProvider as unknown as NonNullable<EvalRunnerOptions["provider"]>;

    const result = await runEvalTask(task, { provider });
    expect(result.passed).toBe(false);
    expect(result.failureKind).toBe("network");
  });

  it("sends follow-up turns to the SAME session, so history accumulates (A4 multi-turn)", async () => {
    // The invariant that makes a multi-turn task a task: turn 2 must see what
    // turn 1 did. A runner that built a fresh session per turn would still
    // "run" both prompts and every assertion would look identical.
    const requests: string[] = [];
    const recordingProvider = {
      id: "openai",
      displayName: "recording scripted",
      isConfigured: () => true,
      async *streamCompletion(request: { messages: Array<{ role: string; content: Array<{ type: string; text?: string }> }> }) {
        requests.push(
          request.messages
            .flatMap((m) => m.content.filter((c) => c.type === "text").map((c) => c.text ?? ""))
            .join("\n")
        );
        yield { type: "usage" as const, inputTokens: 1, outputTokens: 1 };
        yield { type: "turn_end" as const, stopReason: "end_turn" as const };
      },
    };
    const base = createMockTask("task-multiturn", true);
    fs.writeFileSync(base.assertionScript, "#!/bin/bash\nexit 0\n");
    fs.chmodSync(base.assertionScript, 0o755);
    const task: EvalTask = {
      ...base,
      prompt: "first turn: add a helper",
      followUps: ["second turn: now use it"],
      timeoutMs: 30_000,
    };

    const result = await runEvalTask(task, {
      provider: recordingProvider as unknown as NonNullable<EvalRunnerOptions["provider"]>,
    });

    expect(result.turns).toBe(2);
    expect(requests).toHaveLength(2);
    expect(requests[0]).toContain("first turn: add a helper");
    // Turn 2's request carries turn 1 — same session, accumulated history.
    expect(requests[1]).toContain("first turn: add a helper");
    expect(requests[1]).toContain("second turn: now use it");
  }, 30_000);

  it("loadEvalTasks carries followUps and drops blank turns (A4 multi-turn)", () => {
    const task = createMockTask("task-multiturn");
    const configPath = path.join(task.taskDir, "task.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        name: "Multi-turn",
        category: "feature",
        prompt: "first",
        timeoutMs: 60000,
        fast: false,
        followUps: ["second", "", "   ", "third"],
      })
    );

    const [loaded] = loadEvalTasks(tmpDir);
    // Blank entries are dropped: a stray "" would be an empty user turn, which
    // reads to the model as a nudge and to the report as a turn that never
    // happened.
    expect(loaded.followUps).toEqual(["second", "third"]);
  });

  it("sends every follow-up on the SAME session, so history accumulates", async () => {
    // The invariant multi-turn exists for: turn 2 must be graded on what turn 1
    // actually left behind. A fresh session per turn would satisfy `turns: 2` and
    // measure nothing, so this asserts the accumulated history itself.
    const requestsSeen: string[] = [];
    const recorder = {
      id: "openai",
      displayName: "recorder",
      isConfigured: () => true,
      async *streamCompletion(request: { messages: Array<{ content: unknown }> }) {
        requestsSeen.push(JSON.stringify(request.messages.map((m) => m.content)));
        yield { type: "usage" as const, inputTokens: 1, outputTokens: 1 };
        yield { type: "turn_end" as const, stopReason: "end_turn" as const };
      },
    };
    const base = createMockTask("task-turns", true);
    fs.writeFileSync(base.assertionScript, "#!/bin/bash\nexit 0\n");
    fs.chmodSync(base.assertionScript, 0o755);
    const task = { ...base, followUps: ["second turn", "third turn"] };
    const provider = recorder as unknown as NonNullable<EvalRunnerOptions["provider"]>;

    const result = await runEvalTask(task, { provider, respectTaskTimeout: true });

    expect(result.turns).toBe(3);
    expect(requestsSeen.length).toBe(3);
    // Turn 1 saw only its own prompt …
    expect(requestsSeen[0]).toContain("Fix the bug in file.txt");
    expect(requestsSeen[0]).not.toContain("second turn");
    // … turn 2 saw turn 1 AND itself (same session), and turn 3 saw all three.
    expect(requestsSeen[1]).toContain("Fix the bug in file.txt");
    expect(requestsSeen[1]).toContain("second turn");
    expect(requestsSeen[1]).not.toContain("third turn");
    expect(requestsSeen[2]).toContain("second turn");
    expect(requestsSeen[2]).toContain("third turn");
  }, 30_000);

  it("respectTaskTimeout extends, never truncates, a fixture's own budget", async () => {
    // The time-shaped twin of AUDIT A1 (every run force-capped at 4,096 tokens):
    // the A/B harness passed a 120s clock that overrode the harder tier's declared
    // 180s, so a long-horizon task could be graded as a capability failure for a
    // cap nobody shipped. This task outlives the harness's 400ms cap and finishes
    // well inside its own 30s budget.
    const slowProvider = {
      id: "openai",
      displayName: "slow scripted",
      isConfigured: () => true,
      async *streamCompletion() {
        await new Promise((resolve) => setTimeout(resolve, 1200));
        yield { type: "text_delta" as const, text: "slow work done" };
        yield { type: "usage" as const, inputTokens: 1, outputTokens: 1 };
        yield { type: "turn_end" as const, stopReason: "end_turn" as const };
      },
    };
    const base = createMockTask("task-slow", true);
    // The scripted provider writes nothing, so the assertion must pass on the
    // pristine setup — this test is about the CLOCK, not the work.
    fs.writeFileSync(base.assertionScript, "#!/bin/bash\nexit 0\n");
    fs.chmodSync(base.assertionScript, 0o755);
    const task = { ...base, timeoutMs: 30_000 };
    const provider: NonNullable<EvalRunnerOptions["provider"]> =
      slowProvider as unknown as NonNullable<EvalRunnerOptions["provider"]>;

    const truncated = await runEvalTask(task, { provider, timeoutMs: 400 });
    expect(truncated.error).toContain("timed out");
    expect(truncated.passed).toBe(false);

    const respected = await runEvalTask(task, {
      provider,
      timeoutMs: 400,
      respectTaskTimeout: true,
    });
    expect(respected.error).toBeUndefined();
    expect(respected.passed).toBe(true);
  }, 30_000);

  it("runEvalTask captures failure when assertions fail", async () => {
    const task = createMockTask("task-fail", false);
    const result = await runEvalTask(task, { useMock: true });

    expect(result.passed).toBe(false);
    expect(result.taskId).toBe("task-fail");
    expect(result.error).toContain("Intentional failure");
    // A8: an assertion failure carries a STRUCTURED task origin, so the A/B
    // harness never has to infer it from the message text.
    expect(result.failureKind).toBe("task");
  });

  it("createEvalReport aggregates results and computes accurate pass rate", () => {
    const results = [
      {
        taskId: "t1",
        name: "Task 1",
        category: "bugfix",
        passed: true,
        turns: 1,
        wallClockMs: 120,
        tokensUsed: { input: 100, output: 50 },
        toolCalls: 1,
      },
      {
        taskId: "t2",
        name: "Task 2",
        category: "feature",
        passed: false,
        turns: 1,
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
        turns: 1,
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
          turns: 1,
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
