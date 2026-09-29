import { describe, expect, it } from "vitest";
import { assessSignificance, type AbTrial } from "../experiment.js";

/**
 * PHASE 38.4 — A 20-POINT GAP IS NOT ALWAYS A 20-POINT DIFFERENCE
 *
 * The first live run (inception/mercury-2.5, 5 diagnose tasks, 2 trials) printed
 * "baseline beats candidate by 20 points … SIGNIFICANT: yes". The verdict was
 * produced by a rule that asked only `trials >= 2`.
 *
 * On a five-task fixture, one task flipping IS twenty points. The run was
 * therefore reporting the size of the fixture, not a property of either prompt
 * — and the candidate arm, which had genuinely lost, would have been discarded
 * on the strength of a number that proved nothing.
 *
 * Every case below is a reconstruction of that shape. The bar is expressed in
 * tasks that flipped the SAME way on every trial.
 */

function trial(
  taskId: string,
  arm: string,
  trialNo: number,
  passed: boolean
): AbTrial {
  return {
    taskId,
    arm,
    trial: trialNo,
    passed,
    providerError: false,
    wallClockMs: 1_000,
    toolCalls: 3,
    tokens: { input: 100, output: 20 },
  };
}

/**
 * Build a realistic two-arm fixture.
 *
 * The first cut of this helper made every task the candidate did not lose a
 * candidate WIN, so an "arm loses 4 of 5" scenario silently became "the
 * candidate wins 4 of 5" and the assertions below were testing nothing. Real
 * runs have a third category — tasks NEITHER arm solves — and omitting it
 * inflates the apparent gap. `neither` models it.
 */
function fixture(
  n: number,
  opts: { baselineWins?: string[]; candidateWins?: string[]; neither?: string[] },
  arms = ["baseline", "candidate"],
  rounds = 2
): AbTrial[] {
  const baselineWins = opts.baselineWins ?? [];
  const candidateWins = opts.candidateWins ?? [];
  const out: AbTrial[] = [];
  for (const taskId of Array.from({ length: n }, (_, i) => `task-${i + 1}`)) {
    for (const arm of arms) {
      const passed =
        arm === "baseline" ? baselineWins.includes(taskId) : candidateWins.includes(taskId);
      for (let t = 1; t <= rounds; t++) {
        out.push(trial(taskId, arm, t, passed));
      }
    }
  }
  return out;
}

describe("the first live run's shape must NOT be significant", () => {
  it("rejects a 20-point gap that rests on a single task", () => {
    // 5 tasks: baseline wins one, both arms lose the other four. 1/5 vs 0/5 =
    // 20 points — the exact shape of the run that shipped a false
    // "SIGNIFICANT: yes".
    const trials = fixture(5, { baselineWins: ["task-1"] });
    const gate = assessSignificance(trials, ["baseline", "candidate"], 5, 2);

    expect(gate.leadPoints).toBe(20);
    expect(gate.consistentTasks).toEqual(["task-1"]);
    expect(
      gate.significant,
      "one consistent task out of five is a 20-point gap and nothing else"
    ).toBe(false);
    expect(gate.reason).toMatch(/rests on 1 task/);
  });

  it("names the tasks that flipped between arms as noise", () => {
    // Same task, opposite outcome on different trials for the same arm — the
    // model coin-flips and no prompt conclusion follows.
    const trials: AbTrial[] = [
      trial("flaky", "baseline", 1, true),
      trial("flaky", "baseline", 2, false),
      trial("flaky", "candidate", 1, false),
      trial("flaky", "candidate", 2, true),
      trial("solid", "baseline", 1, true),
      trial("solid", "baseline", 2, true),
      trial("solid", "candidate", 1, false),
      trial("solid", "candidate", 2, false),
    ];
    const gate = assessSignificance(trials, ["baseline", "candidate"], 2, 2);

    expect(gate.unstableTasks).toContain("flaky");
    expect(gate.consistentTasks).toEqual(["solid"]);
    expect(gate.significant).toBe(false);
    expect(gate.reason).toMatch(/flipped between arms/);
  });
});

describe("a difference that IS reproducible is reported as significant", () => {
  it("accepts a gap resting on two or more unanimous tasks", () => {
    // 6 tasks: baseline takes three, the candidate takes none, three are
    // unsolvable by either. 3/6 vs 0/6 = 50 points across three unanimous
    // tasks.
    const trials = fixture(6, { baselineWins: ["task-1", "task-2", "task-3"] });
    const gate = assessSignificance(trials, ["baseline", "candidate"], 6, 2);

    expect(gate.significant).toBe(true);
    expect(gate.leader).toBe("baseline");
    expect(gate.leadPoints).toBe(50);
    expect(gate.consistentTasks).toHaveLength(3);
  });

  it("works when the CANDIDATE wins — the rule is not pro-baseline", () => {
    const trials = fixture(6, { candidateWins: ["task-1", "task-2", "task-3"] });
    const gate = assessSignificance(trials, ["baseline", "candidate"], 6, 2);

    expect(gate.significant).toBe(true);
    expect(gate.leader).toBe("candidate");
    expect(gate.leadPoints).toBe(50);
  });
});

describe("too few trials is never enough, however clean the gap", () => {
  it("refuses a single trial even with every task unanimous", () => {
    const trials = fixture(4, { baselineWins: ["task-1", "task-2", "task-3", "task-4"] }, ["baseline", "candidate"], 1);
    const gate = assessSignificance(trials, ["baseline", "candidate"], 4, 1);

    expect(gate.leadPoints).toBe(100);
    expect(gate.significant).toBe(false);
    expect(gate.reason).toMatch(/only 1 trial/);
  });
});

describe("degenerate inputs report honestly", () => {
  it("reports no difference when both arms tie", () => {
    const trials = fixture(4, { baselineWins: ["task-1", "task-2"] , candidateWins: ["task-3", "task-4"] });
    const gate = assessSignificance(trials, ["baseline", "candidate"], 4, 2);
    expect(gate.significant).toBe(false);
    expect(gate.leadPoints).toBe(0);
    expect(gate.reason).toMatch(/scored the same/);
  });

  it("ignores provider errors rather than counting them as losses", () => {
    // An arm that was rate-limited did not fail the task; grading it as a miss
    // would manufacture a gap out of the environment.
    const trials: AbTrial[] = [
      { ...trial("t1", "baseline", 1, true), providerError: true },
      { ...trial("t1", "candidate", 1, true) },
      trial("t2", "baseline", 1, true),
      trial("t2", "candidate", 1, true),
      trial("t3", "baseline", 1, true),
      trial("t3", "candidate", 1, false),
    ];
    const gate = assessSignificance(trials, ["baseline", "candidate"], 3, 1);
    // Only t3 is graded and it is a single trial, so nothing is significant —
    // but the provider error must not have become a candidate loss.
    expect(gate.significant).toBe(false);
    expect(gate.reason).toMatch(/only 1 trial/);
  });

  it("reports an empty task set as nothing to compare", () => {
    const gate = assessSignificance([], ["baseline", "candidate"], 0, 3);
    expect(gate.significant).toBe(false);
    expect(gate.reason).toMatch(/nothing to compare/);
  });
});
