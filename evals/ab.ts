#!/usr/bin/env node
/**
 * Phase 38.4 — Prompt A/B harness CLI.
 *
 *   npx tsx evals/ab.ts --provider inception --model mercury-2.5 [--trials 3] [--filter multifile]
 *   npx tsx evals/ab.ts --provider openrouter --model stealth/space-bunny-alpha
 *   npx tsx evals/ab.ts --mock --filter bugfix
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
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runPromptExperiment, type AbArm } from "../packages/core/src/eval/index.js";
import {
  EVAL_AB_TASK_DELAY_MS,
  EVAL_LIVE_TASK_TIMEOUT_MS,
  DEFAULT_MAX_TOKENS,
} from "../packages/core/src/config/constants.js";

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

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i !== -1 ? args[i + 1] : undefined;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const useMock = args.includes("--mock") || (!args.includes("--provider") && !process.env.ANVIL_PROVIDER);
  const providerId = flag(args, "provider") ?? process.env.ANVIL_PROVIDER;
  const modelId = flag(args, "model") ?? process.env.ANVIL_MODEL;
  const taskFilter = flag(args, "filter");
  const trialsRaw = Number(flag(args, "trials") ?? "1");
  const trials = Number.isFinite(trialsRaw) && trialsRaw > 0 ? Math.floor(trialsRaw) : 1;
  const baselineOnly = args.includes("--baseline-only");

  const baseline: AbArm = {
    name: "baseline",
    profile: {
      systemPrompt:
        "You are Anvil, a terminal coding agent. Be concise.\n\n" +
        "This project declares its own rules in AGENTS.md / .anvil/rules. Read them and follow them.",
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
  console.log(`arms     : ${arms.map((a) => a.name).join(" vs ")}`);
  console.log("=".repeat(74));

  const result = await runPromptExperiment(
    arms,
    {
      tasksDir: TASKS_DIR,
      useMock,
      ...(providerId ? { providerId } : {}),
      ...(modelId ? { modelId } : {}),
      ...(taskFilter ? { taskFilter } : {}),
      timeoutMs: useMock ? 30_000 : EVAL_LIVE_TASK_TIMEOUT_MS,
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
  console.log("=".repeat(74));
  process.exit(0);
}

void main();
