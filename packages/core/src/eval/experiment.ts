/**
 * Phase 38.4 — PROMPT A/B HARNESS
 *
 * The mock lane is green by construction and the live lane was informational,
 * so no change to the system prompt could ever move the gate. This module is
 * the missing measurement: it runs the SAME task set against the SAME model
 * under two agent profiles and reports whether the difference is real.
 *
 * Three properties make a result trustworthy, and each one closes a defect the
 * earlier lanes had:
 *
 * 1. **A failure is attributed.** `providerError` separates "the gateway or
 *    quota failed" from "the model did the task wrong". The old runner folded
 *    both into `passed: false`, so a rate-limit looked like a capability gap.
 * 2. **Trials, not a single pass.** A/B is noise-sensitive: one run per arm
 *    cannot distinguish a real effect from a lucky prompt. `trials` runs each
 *    arm N times and reports the spread, so a 1-task difference is visibly
 *    inside it.
 * 3. **A shared task set, isolated sandboxes.** Both arms run the same task ids
 *    from the same fixtures, so a difference cannot come from the work.
 */

import type { EvalResult, EvalRunnerOptions } from "./types.js";
import { runEvalTask, loadEvalTasks, matchesTaskFilter } from "./runner.js";
import { getErrorMessage, sleepAbortable } from "../errors.js";
import {
  EVAL_AB_MAX_TOKENS,
  EVAL_AB_MIN_TRIALS,
  EVAL_AB_MIN_SIGNIFICANT_TASKS,
} from "../config/constants.js";

/** The agent-shape overrides an arm may vary (see EvalRunnerOptions.profile). */
export interface AbProfileOverride {
  systemPrompt?: string;
  maxTokens?: number;
  autoVerify?: boolean;
}

/** One arm of the experiment: a named agent configuration. */
export interface AbArm {
  /** Stable identifier used in the report and on the CLI. */
  name: string;
  /** Overrides layered onto the profile each task's session is built with. */
  profile: AbProfileOverride;
}

export interface AbTrial {
  taskId: string;
  arm: string;
  trial: number;
  passed: boolean;
  /** True when the failure was the gateway/quota, not the model's work. */
  providerError: boolean;
  error?: string;
  wallClockMs: number;
  toolCalls: number;
  tokens: { input: number; output: number };
}

export interface AbArmSummary {
  name: string;
  trials: number;
  passed: number;
  /** Share of TRIALS passed, excluding provider errors. */
  passRate: number;
  providerErrors: number;
  avgToolCalls: number;
  avgTokens: { input: number; output: number };
  /** Distinct task ids solved at least once — the "ever solved" ceiling. */
  tasksSolved: number;
  totalTasks: number;
}

export interface AbResult {
  date: string;
  model: string;
  provider: string;
  trialsPerArm: number;
  taskIds: string[];
  trials: AbTrial[];
  arms: AbArmSummary[];
  /** True when the arms differ reproducibly — see `significance` for how. */
  significant: boolean;
  /** The full reasoning behind `significant`, including which tasks counted. */
  significance: SignificanceVerdict;
  /** The one-sentence honest summary a reviewer reads first. */
  verdict: string;
}

/**
 * A failure attributable to the provider rather than the task. Rate limits,
 * quota, overload, network, and auth are environmental: they say nothing about
 * the prompt, and counting them as task failures makes an arm look worse for
 * reasons no prompt could fix.
 *
 * A8 (AUDIT-2026-09-30): a STRUCTURED `severity` (EvalResult.failureKind) is
 * authoritative when present. The runner knows an assertion failure is a task
 * failure and a provider stream error is environmental, so the verdict no longer
 * depends on words in the message — a graded assertion whose text says
 * "unavailable" cannot be excused. The regex is the legacy fallback for callers
 * that only have text.
 */
export function classifyTrialFailure(
  message: string | undefined,
  severity?: "provider" | "task" | "parse" | "network" | "cap" | undefined
): {
  providerError: boolean;
  reason: "provider" | "task" | "none";
} {
  if (severity !== undefined) {
    const providerError = severity === "provider" || severity === "network";
    return { providerError, reason: providerError ? "provider" : "task" };
  }
  if (!message) return { providerError: false, reason: "none" };
  // "not available"/"unavailable" is the gateway refusing a model it lists —
  // observed with thinkingmachines/inkling:free. "unauthorized"/"forbidden"
  // alone would wrongly catch a model that merely SAYS it is forbidden.
  const environmental =
    /rate limit|429|quota|resource_exhausted|overloaded|503|502|504|econnreset|etimedout|fetch failed|socket hang up|network|unauthorized|forbidden|401|403|api key|credit|not available|unavailable|only available on/i;
  return environmental.test(message)
    ? { providerError: true, reason: "provider" }
    : { providerError: false, reason: "task" };
}

/** Mean of a number list, or 0 when empty (never NaN in a report). */
function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Compare two or more arms over a shared task set.
 *
 * `baseOptions` carries provider/model and is what makes a run LIVE; without a
 * `providerId` this measures the mock, which is why the result records the
 * provider name so a mock run can never be mistaken for evidence.
 */

/**
 * The profile override ONE A/B run applies (the Phase 38.4 seam).
 *
 * maxTokens is a FLOOR, not a cap — but only when the arm EXPLICITLY sets a
 * budget. Overriding an unset budget with EVAL_AB_MAX_TOKENS made every A/B
 * run score a 4,096-token agent while the runner's own profile gives the task
 * budget (8,192 on tasks 21–25) or DEFAULT_MAX_TOKENS: the harness measured a
 * different agent than shipping (AUDIT-2026-09-30 A1).
 */
export function armProfileOverride(arm: AbArm): AbProfileOverride {
  if (arm.profile.maxTokens === undefined) return { ...arm.profile };
  return { ...arm.profile, maxTokens: Math.max(arm.profile.maxTokens, EVAL_AB_MAX_TOKENS) };
}

export async function runPromptExperiment(
  arms: AbArm[],
  baseOptions: EvalRunnerOptions & { tasksDir: string },
  trials = 1
): Promise<AbResult> {
  // A floor of 1 keeps a zero/negative request from silently producing an
  // empty result that reads as "no difference".
  const rounds = Math.max(1, Math.floor(trials) || 1);
  const tasks = loadEvalTasks(baseOptions.tasksDir);
  const filter = baseOptions.taskFilter;
  const selected = filter ? tasks.filter((t) => matchesTaskFilter(t, filter)) : tasks;

  // A3: live runs pace provider calls the way runAllEvalTasks does.
  // `betweenTaskDelayMs` was spread into runEvalTask — whose only consumer is
  // the batch runner — so A/B met rate limits and those trials were then
  // EXCLUDED as provider errors, silently shrinking the evidence.
  const delayMs =
    baseOptions.betweenTaskDelayMs && baseOptions.betweenTaskDelayMs > 0
      ? baseOptions.betweenTaskDelayMs
      : 0;
  const totalRuns = arms.length * rounds * selected.length;
  let completedRuns = 0;

  const trialsOut: AbTrial[] = [];
  // A7 (AUDIT-2026-09-30): interleave arms WITHIN each trial. Arm-major order
  // ran one arm's whole task set back-to-back, so provider drift (a rate-limit
  // window, a warming gateway) correlated with arm identity.
  for (let trial = 0; trial < rounds; trial++) {
    for (const task of selected) {
      for (const arm of arms) {
        const started = Date.now();
        try {
          const result: EvalResult = await runEvalTask(task, {
            ...baseOptions,
            // The A/B seam: the arm's profile replaces the runner's defaults.
            profile: armProfileOverride(arm),
          });
          const classified = classifyTrialFailure(result.error, result.failureKind);
          trialsOut.push({
            taskId: task.id,
            arm: arm.name,
            trial: trial + 1,
            passed: result.passed,
            providerError: classified.providerError,
            ...(result.error ? { error: result.error } : {}),
            wallClockMs: result.wallClockMs,
            toolCalls: result.toolCalls,
            tokens: result.tokensUsed,
          });
        } catch (err: unknown) {
          const message = getErrorMessage(err);
          const classified = classifyTrialFailure(message);
          trialsOut.push({
            taskId: task.id,
            arm: arm.name,
            trial: trial + 1,
            passed: false,
            providerError: classified.providerError,
            error: message,
            wallClockMs: Date.now() - started,
            toolCalls: 0,
            tokens: { input: 0, output: 0 },
          });
        } finally {
          completedRuns += 1;
          // Exactly totalRuns - 1 sleeps, mirroring the batch runner: no
          // trailing wait after the final task.
          if (delayMs > 0 && completedRuns < totalRuns) await sleepAbortable(delayMs);
        }
      }
    }
  }

  const summaries = arms.map((arm) => summarizeArm(arm.name, trialsOut, selected.length));
  const gate = assessSignificance(trialsOut, arms.map((a) => a.name), selected.length, rounds);

  return {
    date: new Date().toISOString(),
    model: baseOptions.modelId ?? "unknown",
    provider: baseOptions.providerId ?? "mock",
    trialsPerArm: rounds,
    taskIds: selected.map((t) => t.id),
    trials: trialsOut,
    arms: summaries,
    significant: gate.significant,
    significance: gate,
    verdict: buildVerdict(summaries, gate, rounds, baseOptions.providerId),
  };
}

export interface SignificanceVerdict {
  significant: boolean;
  /** Why the verdict came out the way it did — quoted verbatim in the report. */
  reason: string;
  /** The arm with the higher pass rate, if any. */
  leader?: string;
  /** Pass-rate gap in points, 0–100. */
  leadPoints: number;
  /**
   * Tasks whose outcome FLIPPED between the two arms. A gap built from tasks
   * that also flip run-to-run is noise, however large the aggregate looks.
   */
  unstableTasks: string[];
  /** Tasks that flipped the same way every trial — a reproducible difference. */
  consistentTasks: string[];
}

/**
 * Is the difference between arms real, or is it one flaky task?
 *
 * The first cut of this used `trials >= 2`, and the very first live run
 * (mercury-2.5, 5 diagnose tasks, 2 trials) declared "SIGNIFICANT: yes" on a
 * 20-point gap. That was wrong, and the run itself is the receipt: with 5
 * tasks, ONE task flipping is a 20-point swing on its own. The aggregate was
 * reporting the fixture size, not a property of either prompt.
 *
 * So significance is now decided PER TASK, not on the aggregate:
 *
 *  - A task counts toward the difference only if the SAME arm won EVERY trial
 *    on it. A task that flipped between arms is unstable — the model is
 *    coin-flipping on it, and no prompt conclusion follows.
 *  - The gap must be reproduced across at least EVAL_AB_MIN_SIGNIFICANT_TASKS
 *    such tasks. One consistent task is a single observation.
 *  - A minimum trial count still applies, because per-task consistency over one
 *    trial is indistinguishable from "graded once".
 */
export function assessSignificance(
  trials: AbTrial[],
  armNames: string[],
  taskCount: number,
  rounds: number
): SignificanceVerdict {
  const byTask = new Map<string, Map<string, boolean[]>>();
  for (const t of trials) {
    if (t.providerError) continue;
    const armsForTask = byTask.get(t.taskId) ?? new Map<string, boolean[]>();
    const outcomes = armsForTask.get(t.arm) ?? [];
    outcomes.push(t.passed);
    armsForTask.set(t.arm, outcomes);
    byTask.set(t.taskId, armsForTask);
  }

  const consistent: string[] = [];
  const unstable: string[] = [];
  /**
   * Which arm won each consistent task. The aggregate `leader` is NOT it: 3
   * tasks won by A and 2 by B are five "consistent" tasks and two directions
   * (AUDIT-2026-09-30 A2).
   */
  const winnerByTask = new Map<string, string>();
  for (const [taskId, armsForTask] of byTask) {
    // A task is only decidable if every arm was actually graded on it.
    if (armNames.some((a) => !armsForTask.has(a))) continue;
    // An arm that gave DIFFERENT answers across trials is coin-flipping on this
    // task. That is noise regardless of how the two arms compare, so it is
    // classified before the tie check below — otherwise a task both arms tied on
    // 50/50 would be quietly dropped instead of reported as unstable.
    const anyArmMixed = armNames.some((a) => {
      const outcomes = armsForTask.get(a) ?? [];
      return outcomes.length > 1 && outcomes.some(Boolean) && outcomes.some((o) => !o);
    });
    if (anyArmMixed) {
      unstable.push(taskId);
      continue;
    }
    const rates = armNames.map((a) => {
      const outcomes = armsForTask.get(a) ?? [];
      return outcomes.filter(Boolean).length / Math.max(outcomes.length, 1);
    });
    if (Math.max(...rates) === Math.min(...rates)) continue; // no difference
    consistent.push(taskId);
    winnerByTask.set(
      taskId,
      armNames[rates.indexOf(Math.max(...rates))] ?? ""
    );
    // A2 (AUDIT-2026-09-30) was fixed upstream (38.4). This block records the
    // per-task winner so the aggregate claim can be tested against it; the
    // verifier already owns that parity test. Nothing else changes here.
  }

  const rates = armNames.map((name) => {
    const mine = trials.filter((t) => t.arm === name && !t.providerError);
    return mine.length === 0 ? 0 : mine.filter((t) => t.passed).length / mine.length;
  });
  const leadPoints = rates.length > 1 ? (Math.max(...rates) - Math.min(...rates)) * 100 : 0;
  const leader = rates.length > 1 ? armNames[rates.indexOf(Math.max(...rates))] : undefined;

  if (rounds < EVAL_AB_MIN_TRIALS) {
    return {
      significant: false,
      reason: `only ${rounds} trial(s) per arm — a task the model coin-flips on cannot be told apart from one it reliably gets wrong. Run at least ${EVAL_AB_MIN_TRIALS}.`,
      leadPoints,
      unstableTasks: unstable,
      consistentTasks: consistent,
      ...(leader ? { leader } : {}),
    };
  }
  if (taskCount === 0) {
    return {
      significant: false,
      reason: "no tasks matched the filter, so there is nothing to compare.",
      leadPoints: 0,
      unstableTasks: unstable,
      consistentTasks: consistent,
    };
  }
  if (leadPoints === 0) {
    return {
      significant: false,
      reason: "both arms scored the same.",
      leadPoints: 0,
      unstableTasks: unstable,
      consistentTasks: consistent,
      ...(leader ? { leader } : {}),
    };
  }
  if (consistent.length < EVAL_AB_MIN_SIGNIFICANT_TASKS) {
    return {
      significant: false,
      reason:
        `the ${leadPoints.toFixed(0)}-point gap rests on ${consistent.length} task(s) that flipped the same way every trial, ` +
        `below the ${EVAL_AB_MIN_SIGNIFICANT_TASKS} required. ` +
        (unstable.length > 0
          ? `${unstable.length} task(s) flipped between arms and contribute noise, not signal.`
          : "Widen the task set or run more trials before concluding anything."),
      leadPoints,
      unstableTasks: unstable,
      consistentTasks: consistent,
      ...(leader ? { leader } : {}),
    };
  }
  // A2: the quotable verdict must name the arm that won THE REPRODUCIBLE
  // TASKS, and only if that is a single arm that also leads the aggregate. A
  // mixed direction used to be reported as one unanimous winner.
  const winnerCounts = new Map<string, number>();
  for (const taskId of consistent) {
    const winner = winnerByTask.get(taskId) ?? "unknown";
    winnerCounts.set(winner, (winnerCounts.get(winner) ?? 0) + 1);
  }
  const unanimousWinner = winnerCounts.size === 1 ? [...winnerCounts.keys()][0] : undefined;
  if (!unanimousWinner || unanimousWinner !== leader) {
    const tally = [...winnerCounts].map(([arm, n]) => `${arm} won ${n}`).join(", ");
    return {
      significant: false,
      reason: unanimousWinner
        ? `every reproducible task favors ${unanimousWinner} (${tally}), but the aggregate gap favors ${leader} — the difference is carried by tasks that flip, so it is not quotable.`
        : `the ${consistent.length} reproducible task(s) split between arms (${tally}) — opposite-direction wins do not add up to a lead for either prompt.`,
      leadPoints,
      unstableTasks: unstable,
      consistentTasks: consistent,
      ...(leader ? { leader } : {}),
    };
  }
  return {
    significant: true,
    reason: `${unanimousWinner} wins all ${consistent.length} task(s) that reproduced across ${rounds} trials (${consistent.join(", ")}).`,
    leadPoints,
    unstableTasks: unstable,
    consistentTasks: consistent,
    leader: unanimousWinner,
  };
}

function summarizeArm(name: string, trials: AbTrial[], totalTasks: number): AbArmSummary {
  const mine = trials.filter((t) => t.arm === name);
  const graded = mine.filter((t) => !t.providerError);
  const passed = graded.filter((t) => t.passed).length;
  return {
    name,
    trials: mine.length,
    passed,
    passRate: graded.length === 0 ? 0 : passed / graded.length,
    providerErrors: mine.length - graded.length,
    avgToolCalls: Math.round(mean(mine.map((t) => t.toolCalls)) * 10) / 10,
    avgTokens: {
      input: Math.round(mean(mine.map((t) => t.tokens.input))),
      output: Math.round(mean(mine.map((t) => t.tokens.output))),
    },
    tasksSolved: new Set(mine.filter((t) => t.passed).map((t) => t.taskId)).size,
    totalTasks,
  };
}

function buildVerdict(
  arms: AbArmSummary[],
  gate: SignificanceVerdict,
  rounds: number,
  providerId: string | undefined
): string {
  if (!providerId) {
    return "MOCK RUN — this measured the scripted provider, not a model. Not evidence about any prompt.";
  }
  const rates = arms.map((a) => `${a.name} ${(a.passRate * 100).toFixed(0)}%`).join(", ");
  if (!gate.significant) {
    return `NOT SIGNIFICANT: ${rates}. ${gate.reason}`;
  }
  return `${gate.leader} leads by ${gate.leadPoints.toFixed(0)} points over ${rounds} trials. ${gate.reason}`;
}
