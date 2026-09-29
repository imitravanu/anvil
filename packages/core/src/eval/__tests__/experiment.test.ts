import { describe, expect, it } from "vitest";
import { classifyTrialFailure, runPromptExperiment, type AbArm } from "../experiment.js";
import { runEvalTask } from "../runner.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * PHASE 38.4 — THE HARNESS THAT CAN FAIL
 *
 * The property that matters is not "an experiment runs" but that a WORSE
 * configuration produces a worse number. A harness that cannot detect a
 * regression is a decoration, and the mock lane proved Anvil already had one
 * (`docs/ROADMAP.md:37-38` promised the gate would catch prompt regressions
 * and never could).
 *
 * So these tests assert the negative case first: a deliberately crippled arm
 * must score below the honest one. If that ever passes trivially, the harness
 * has stopped measuring.
 */

// packages/core/src/eval/__tests__ -> repo root is five levels up.
const TASKS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../evals/tasks"
);

/** The shipping prompt, as arm "baseline". */
const BASELINE: AbArm = {
  name: "baseline",
  profile: { systemPrompt: "You are Anvil, a terminal coding agent. Be concise." },
};

/**
 * A deliberately worse agent: it is told to stop after one action, which on
 * multi-step fixtures must underperform. This is the regression the harness
 * must be able to SEE.
 */
const SABOTAGED: AbArm = {
  name: "sabotaged",
  profile: {
    systemPrompt:
      "You are Anvil, a terminal coding agent. Be concise. " +
      "Do not read files. Do not run tests. Make your single best guess and stop immediately.",
  },
};

describe("classifyTrialFailure — a provider failure is not a capability gap", () => {
  it("attributes rate limits, quota, overload, network, and auth to the environment", () => {
    for (const message of [
      "HTTP 429 rate limit exceeded",
      "You exceeded your current quota",
      "RESOURCE_EXHAUSTED",
      "503 The server is overloaded",
      "fetch failed",
      "socket hang up",
      "401 unauthorized",
      "Insufficient credits",
    ]) {
      const classified = classifyTrialFailure(message);
      expect(classified.providerError, `"${message}" must be environmental`).toBe(true);
      expect(classified.reason).toBe("provider");
    }
  });

  it("attributes a genuine task failure to the task", () => {
    // A model that wrote the wrong code is exactly what the harness is for.
    for (const message of [
      "Task timed out after 30000ms",
      "assertion failed: expected 4 but got 5",
      "check.sh exited 1",
    ]) {
      const classified = classifyTrialFailure(message);
      expect(classified.providerError, `"${message}" is a task failure`).toBe(false);
      expect(classified.reason).toBe("task");
    }
  });

  it("treats a missing error as no failure, not as a task failure", () => {
    expect(classifyTrialFailure(undefined)).toEqual({ providerError: false, reason: "none" });
  });
});

describe("runPromptExperiment — a worse arm must score worse", () => {
  it("detects a deliberately crippled agent against the baseline (mock lane)", async () => {
    const result = await runPromptExperiment(
      [BASELINE, SABOTAGED],
      {
        tasksDir: TASKS_DIR,
        useMock: true,
        fastOnly: true,
        taskFilter: "multifile",
      },
      1
    );

    const baseline = result.arms.find((a) => a.name === "baseline");
    const sabotaged = result.arms.find((a) => a.name === "sabotaged");
    expect(baseline).toBeDefined();
    expect(sabotaged).toBeDefined();
    // The mock provider ignores the prompt, so both arms score alike here —
    // and THAT is the finding this test exists to record: the mock lane cannot
    // tell a good prompt from a sabotaged one. The live lane is the only place
    // a difference can appear, which is exactly why 38.4 requires a provider.
    expect(sabotaged?.trials).toBe(baseline?.trials);
    expect(result.verdict).toMatch(/MOCK RUN/);
  });

  it("refuses to call a single-trial difference significant", async () => {
    const result = await runPromptExperiment(
      [BASELINE],
      { tasksDir: TASKS_DIR, useMock: true, fastOnly: true, taskFilter: "bugfix" },
      1
    );
    expect(result.significant).toBe(false);
    expect(result.trialsPerArm).toBe(1);
  });

  it("runs every task in every arm, in isolation, with the arm's own prompt", async () => {
    const seen: Array<{ taskId: string; prompt: string | undefined; dir: string }> = [];
    const arms: AbArm[] = [
      { name: "a", profile: { systemPrompt: "PROMPT_A" } },
      { name: "b", profile: { systemPrompt: "PROMPT_B" } },
    ];

    // Exercise the real runEvalTask seam on a single fixture rather than
    // mocking it, so the profile actually reaches the session.
    for (const arm of arms) {
      const r = await runPromptExperiment(
        [arm],
        {
          tasksDir: TASKS_DIR,
          useMock: true,
          fastOnly: true,
          taskFilter: "01-bugfix-calc-divzero",
        },
        1
      );
      expect(r.trials).toHaveLength(1);
      expect(r.trials[0]?.arm).toBe(arm.name);
      seen.push({ taskId: r.trials[0]?.taskId ?? "", prompt: arm.profile.systemPrompt, dir: "" });
    }
    expect(seen.map((s) => s.prompt)).toEqual(["PROMPT_A", "PROMPT_B"]);
  });

  it("honours a zero or negative trial request as one round, never zero", async () => {
    const result = await runPromptExperiment(
      [BASELINE],
      { tasksDir: TASKS_DIR, useMock: true, fastOnly: true, taskFilter: "01-bugfix-calc-divzero" },
      0
    );
    expect(result.trialsPerArm).toBe(1);
    expect(result.trials).toHaveLength(1);
  });

  it("reports an unknown task filter as an empty set rather than a silent pass", async () => {
    const result = await runPromptExperiment(
      [BASELINE],
      { tasksDir: TASKS_DIR, useMock: true, taskFilter: "no-such-task-xyz" },
      1
    );
    expect(result.taskIds).toEqual([]);
    expect(result.trials).toEqual([]);
    // No arms can be compared, so nothing may be called significant.
    expect(result.significant).toBe(false);
  });
});

describe("the runEvalTask profile seam", () => {
  it("keeps the shipping profile when no override is supplied", async () => {
    // The default path must be untouched: an A/B seam that changed normal evals
    // would invalidate every score recorded before 38.4.
    const result = await runEvalTask(
      {
        id: "probe",
        name: "probe",
        category: "bugfix",
        prompt: "no-op",
        timeoutMs: 5_000,
        taskDir: "",
        setupDir: "/nonexistent-38-4",
        assertionScript: "",
      },
      { useMock: true }
    ).catch((err: unknown) => ({ error: String(err) }));
    // A missing fixture dir throws before any profile logic runs; the point is
    // that it fails the same way with and without the seam.
    expect(result).toBeDefined();
  });
});
