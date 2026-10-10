#!/usr/bin/env node
/**
 * Phase 38.4 — Prompt A/B harness CLI.
 *
 *   npx tsx evals/ab.ts --provider inception --model mercury-2.5 [--trials 3] [--filter multifile]
 *   npx tsx evals/ab.ts --provider openrouter --model stealth/space-bunny-alpha
 *   npx tsx evals/ab.ts --mock --filter bugfix
 *   npx tsx evals/ab.ts --provider inception --model mercury-2.5 --tasks-dir evals/tasks-hard
 *
 * `--tasks-dir` (Phase 39 A4) points the run at a task set other than the 25
 * short tasks: `evals/tasks-hard` is the harder tier (long horizon, multi-file,
 * structural guards) the saturated set cannot measure a prompt with.
 *
 * Two arms by default: the shipping prompt, and the shipping prompt plus the
 * behavioral guidance that Phase 38.5 intends to land. A `--baseline-only` run
 * measures the CURRENT agent on the live model, which is the baseline every
 * later prompt claim is compared against.
 *
 * Exit code is 0 when the run completed, NOT when the experiment "passed":
 * a harness that failed the build whenever an arm lost would train everyone to
 * distrust it. The verdict line is the output, and it is written to be quoted.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runPromptExperiment, type AbArm } from "../packages/core/src/eval/index.js";
import { saveAbResult } from "../packages/core/src/eval/report.js";
import {
  EVAL_AB_TASK_DELAY_MS,
  EVAL_LIVE_TASK_TIMEOUT_MS,
  DEFAULT_MAX_TOKENS,
} from "../packages/core/src/config/constants.js";
import { ANVIL_BASE_SYSTEM_PROMPT } from "../packages/core/src/config/agentProfile.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TASKS_DIR = path.join(__dirname, "tasks");

/**
 * The candidate prompt for 38.5. Written here as a VARIANT so it can be
 * measured before it is adopted — landing it in the shipping prompt first
 * would be the unevidenced change this phase exists to prevent.
 */
const CANDIDATE_GUIDANCE = `
Work like a careful engineer, not a guesser:
- Before editing a file you have not read in this session, read it first.
- Prefer the project's own conventions over your defaults; match its naming, imports, and error style.
- When a change could break the build or the tests, run them and read the failure before claiming success.
- Make the smallest change that fully solves the request. Do not refactor code you were not asked to touch.
- If a tool reports an error, read the error and fix the cause rather than retrying the same call.
- Say plainly what you did not do, and what you could not verify.`;

// G13 (AUDIT-2026-09-30): fail loud on a valueless flag instead of silently
// treating the next flag (or nothing) as its value — same contract as run.ts.
function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const v = args[i + 1];
  if (v === undefined || v.startsWith("--")) {
    console.error(`[ab] --${name} requires a value.`);
    process.exit(1);
  }
  return v;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const useMock = args.includes("--mock") || (!args.includes("--provider") && !process.env.ANVIL_PROVIDER);
  const providerId = flag(args, "provider") ?? process.env.ANVIL_PROVIDER;
  const modelId = flag(args, "model") ?? process.env.ANVIL_MODEL;
  const taskFilter = flag(args, "filter");
  const trialsFlag = flag(args, "trials");
  // G13: `--trials banana` used to parse to NaN and silently degrade to 1.
  if (trialsFlag !== undefined && !/^[1-9]\d*$/.test(trialsFlag)) {
    console.error(`[ab] Invalid --trials value "${trialsFlag}" (expected a positive integer).`);
    process.exit(1);
  }
  const trials = trialsFlag === undefined ? 1 : Number(trialsFlag);
  const baselineOnly = args.includes("--baseline-only");
  const tasksDirFlag = flag(args, "tasks-dir");
  const tasksDir = tasksDirFlag === undefined ? TASKS_DIR : path.resolve(tasksDirFlag);
  if (tasksDirFlag !== undefined && !fs.existsSync(tasksDir)) {
    console.error(`[ab] --tasks-dir does not exist: ${tasksDir}`);
    process.exit(1);
  }

  const baseline: AbArm = {
    name: "baseline",
    profile: {
      // The shipping prompt, imported from its one owner — a hardcoded copy
      // here would drift from what users run, which is the exact defect
      // (Probe G) this phase opened on.
      systemPrompt:
        ANVIL_BASE_SYSTEM_PROMPT +
        "\n\nThis project declares its own rules in AGENTS.md / .anvil/rules. Read them and follow them.",
    },
  };
  const candidate: AbArm = {
    name: "candidate",
    profile: {
      systemPrompt: `${baseline.profile.systemPrompt}${CANDIDATE_GUIDANCE}`,
    },
  };

  const arms = baselineOnly ? [baseline] : [baseline, candidate];

  console.log("=".repeat(74));
  console.log("PHASE 38.4 — PROMPT A/B");
  console.log("=".repeat(74));
  console.log(`provider : ${useMock ? "mock (NOT evidence about any prompt)" : providerId}`);
  console.log(`model    : ${useMock ? "eval-mock" : modelId ?? "(registry default)"}`);
  console.log(`trials   : ${trials} per arm`);
  console.log(`filter   : ${taskFilter ?? "(all)"}`);
  console.log(`tasks    : ${path.relative(process.cwd(), tasksDir) || tasksDir}`);
  console.log(`arms     : ${arms.map((a) => a.name).join(" vs ")}`);
  console.log("=".repeat(74));

  const result = await runPromptExperiment(
    arms,
    {
      tasksDir: tasksDir,
      useMock,
      ...(providerId ? { providerId } : {}),
      ...(modelId ? { modelId } : {}),
      ...(taskFilter ? { taskFilter } : {}),
      timeoutMs: useMock ? 30_000 : EVAL_LIVE_TASK_TIMEOUT_MS,
      // An arm must not truncate a fixture's own budget: the harder tier budgets
      // 180s per task, and a 120s harness cap would grade it as a failure for a
      // clock nobody shipped (the time-shaped twin of A1).
      respectTaskTimeout: true,
      betweenTaskDelayMs: useMock ? 0 : EVAL_AB_TASK_DELAY_MS,
    },
    trials
  );

  console.log("");
  for (const arm of result.arms) {
    console.log(`--- ${arm.name} ---`);
    console.log(
      `  pass rate     : ${(arm.passRate * 100).toFixed(1)}%  (${arm.passed}/${arm.trials - arm.providerErrors} graded)`,
    );
    console.log(`  tasks solved  : ${arm.tasksSolved}/${arm.totalTasks}`);
    console.log(`  avg tool calls: ${arm.avgToolCalls}`);
    console.log(
      `  avg tokens    : ${arm.avgTokens.input.toLocaleString()} in / ${arm.avgTokens.output.toLocaleString()} out`,
    );
    if (arm.providerErrors > 0) {
      console.log(`  provider errs : ${arm.providerErrors} (excluded from the rate)`);
    }
  }

  const failures = result.trials.filter((t) => !t.passed && !t.providerError);
  if (failures.length > 0) {
    console.log("\n--- task failures (graded) ---");
    for (const f of failures) {
      console.log(`  ${f.arm} / ${f.taskId} (trial ${f.trial}): ${f.error ?? "assertion failed"}`);
    }
  }
  const providerFailures = result.trials.filter((t) => t.providerError);
  if (providerFailures.length > 0) {
    console.log("\n--- provider errors (NOT capability signals) ---");
    for (const f of providerFailures) {
      console.log(`  ${f.arm} / ${f.taskId}: ${f.error ?? "unknown"}`);
    }
  }

  console.log(`\n${"=".repeat(74)}`);
  console.log(`VERDICT: ${result.verdict}`);
  console.log(`SIGNIFICANT: ${result.significant ? "yes" : "no — do not act on this yet"}`);
  if (result.significance) {
    console.log(`  consistent tasks : ${result.significance.consistentTasks.join(", ") || "(none)"}`);
    console.log(`  unstable tasks   : ${result.significance.unstableTasks.join(", ") || "(none)"}`);
    if (!result.significant) {
      console.log("  -> a task is 'unstable' when an arm gave different answers across trials;");
      console.log("     it contributes noise, and no prompt conclusion follows from it.");
    }
  }
  console.log("=".repeat(74));
  // Batch Q (F4, takeover 2026-10-10): the verdict is only printable evidence
  // until it is also a durable artifact — persist it beside the batch reports
  // so a later prompt change can be compared against the run that justified
  // the current one, and `evals/run.ts --report` can surface it.
  const artifactPath = saveAbResult(result);
  console.log(`\nA/B artifact persisted: ${artifactPath}`);
  process.exit(0);
}

void main();
