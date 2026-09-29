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
import { runEvalTask, loadEvalTasks } from "./runner.js";
import { getErrorMessage } from "../errors.js";
import { EVAL_AB_MAX_TOKENS } from "../config/constants.js";

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
  /** True when the arms' pass rates differ by more than the observed spread. */
  significant: boolean;
  /** The one-sentence honest summary a reviewer reads first. */
  verdict: string;
}

/**
 * A failure attributable to the provider rather than the task. Rate limits,
 * quota, overload, network, and auth are environmental: they say nothing about
 * the prompt, and counting them as task failures makes an arm look worse for
 * reasons no prompt could fix.
 */
export function classifyTrialFailure(message: string | undefined): {
  providerError: boolean;
  reason: "provider" | "task" | "none";
} {
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
export async function runPromptExperiment(
  arms: AbArm[],
  baseOptions: EvalRunnerOptions & { tasksDir: string },
  trials = 1
): Promise<AbResult> {
  // A floor of 1 keeps a zero/negative request from silently producing an
  // empty result that reads as "no difference".
  const rounds = Math.max(1, Math.floor(trials) || 1);
  const tasks = loadEvalTasks(baseOptions.tasksDir);
  const selected = baseOptions.taskFilter
    ? tasks.filter((t) => t.id.includes(baseOptions.taskFilter ?? ""))
    : tasks;

  const trialsOut: AbTrial[] = [];
  for (const arm of arms) {
    for (let trial = 0; trial < rounds; trial++) {
      for (const task of selected) {
        const started = Date.now();
        try {
          const result: EvalResult = await runEvalTask(task, {
            ...baseOptions,
            // The A/B seam: the arm's profile replaces the runner's defaults.
            // maxTokens is a FLOOR, not a cap — a reasoning model that burns
            // its budget before answering returns an empty turn, and an arm
            // scoring zero for that reason would be a harness artifact.
            profile: {
              ...arm.profile,
              maxTokens: Math.max(arm.profile.maxTokens ?? 0, EVAL_AB_MAX_TOKENS),
            },
          });
          const classified = classifyTrialFailure(result.error);
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
        }
      }
    }
  }

  const summaries = arms.map((arm) => summarizeArm(arm.name, trialsOut, selected.length));
  const rates = summaries.map((s) => s.passRate);
  const spread = rates.length > 1 ? Math.max(...rates) - Math.min(...rates) : 0;
  // A single-trial difference is not evidence; require a real gap before
  // calling anything significant, and say so plainly when it is not.
  const significant = spread > 0 && rounds >= 2;

  return {
    date: new Date().toISOString(),
    model: baseOptions.modelId ?? "unknown",
    provider: baseOptions.providerId ?? "mock",
    trialsPerArm: rounds,
    taskIds: selected.map((t) => t.id),
    trials: trialsOut,
    arms: summaries,
    significant,
    verdict: buildVerdict(summaries, significant, rounds, baseOptions.providerId),
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
  significant: boolean,
  rounds: number,
  providerId: string | undefined
): string {
  if (!providerId) {
    return "MOCK RUN — this measured the scripted provider, not a model. Not evidence about any prompt.";
  }
  const byRate = [...arms].sort((a, b) => b.passRate - a.passRate);
  const [best, ...rest] = byRate;
  const lead = best.passRate - (rest[0]?.passRate ?? 0);
  if (rounds < 2) {
    return `${best.name} leads at ${(best.passRate * 100).toFixed(0)}%, but ${rounds} trial(s) cannot separate signal from noise. Re-run with more trials before believing this.`;
  }
  if (!significant || lead === 0) {
    return `No difference outside the spread: ${arms.map((a) => `${a.name} ${(a.passRate * 100).toFixed(0)}%`).join(", ")}. The prompt change did not measurably help.`;
  }
  return `${best.name} beats ${rest[0]?.name} by ${(lead * 100).toFixed(0)} points over ${rounds} trials — a real difference, not spread.`;
}
