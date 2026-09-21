#!/usr/bin/env node
/**
 * Phase 17: Verification Harness CLI Runner
 * Run benchmarks locally or in CI:
 *   npx tsx evals/run.ts [--mock] [--fast] [--filter <name>] [--report]
 *   npx tsx evals/run.ts --provider gemini --model gemini-2.0-flash
 * Guardian proof matrix (26.3):
 *   npx tsx evals/run.ts --provider openrouter --model X --guardian=off
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  runAllEvalTasks,
  formatEvalReport,
  formatGuardianDelta,
  formatTrendComparison,
  loadRecentReports,
  resolveEvalsDir,
  findGuardianDeltaPair,
} from "../packages/core/src/eval/index.js";
import { EVAL_RATE_LIMIT_DELAY_MS } from "../packages/core/src/config/constants.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TASKS_DIR = path.join(__dirname, "tasks");

async function main() {
  const args = process.argv.slice(2);

  // 1. Report Mode: Print historical trends
  if (args.includes("--report")) {
    const reports = loadRecentReports(resolveEvalsDir(), 10);
    console.log(formatTrendComparison(reports));
    const { on, off } = findGuardianDeltaPair(reports);
    console.log(formatGuardianDelta(on, off));
    process.exit(0);
  }

  // 2. Parse Flags
  const fastOnly = args.includes("--fast");
  const useMock = args.includes("--mock") || (!args.includes("--provider") && !process.env.ANVIL_PROVIDER);

  let providerId: string | undefined;
  const pIdx = args.indexOf("--provider");
  if (pIdx !== -1 && args[pIdx + 1]) {
    providerId = args[pIdx + 1];
  } else if (process.env.ANVIL_PROVIDER) {
    providerId = process.env.ANVIL_PROVIDER;
  }

  let modelId: string | undefined;
  const mIdx = args.indexOf("--model");
  if (mIdx !== -1 && args[mIdx + 1]) {
    modelId = args[mIdx + 1];
  } else if (process.env.ANVIL_MODEL) {
    modelId = process.env.ANVIL_MODEL;
  }

  let taskFilter: string | undefined;
  const fIdx = args.indexOf("--filter");
  if (fIdx !== -1 && args[fIdx + 1]) {
    taskFilter = args[fIdx + 1];
  }

  // 26.3: guardian toggle. Default ON (product behavior); `--guardian=off` or
  // ANVIL_EVAL_GUARDIAN=off opts OUT so the delta matrix can measure the same
  // tasks with only the interceptor disabled.
  const guardianArg = args.find((a) => a.startsWith("--guardian="));
  const guardianEnv = process.env.ANVIL_EVAL_GUARDIAN;
  const guardianRaw = guardianArg ? guardianArg.slice("--guardian=".length) : guardianEnv;
  if (guardianRaw !== undefined && guardianRaw !== "on" && guardianRaw !== "off") {
    console.error(`[eval] Invalid --guardian value "${guardianRaw}" (expected "on" or "off").`);
    process.exit(1);
  }
  const guardian = guardianRaw === undefined ? true : guardianRaw === "on";

  console.log("===============================================================================");
  console.log(" ANVIL EVALUATION HARNESS — Starting Task Run");
  console.log(` Provider: ${useMock ? "mock (offline deterministic)" : providerId} | Model: ${modelId || (useMock ? "eval-mock" : "default")}`);
  console.log(` Guardian: ${guardian ? "ON" : "OFF"} (interceptor ${guardian ? "active" : "disabled for this run"})`);
  console.log(` Tasks Directory: ${TASKS_DIR}`);
  if (fastOnly) console.log(" Filter: fast tasks only");
  if (taskFilter) console.log(` Filter: matching "${taskFilter}"`);
  console.log("===============================================================================");

  // Operator override for the live-eval lane. Each task.json hardcodes a 30s
  // budget tuned for the instant mock provider, and that per-task value wins in
  // the runner — so live runs died at 30s mid-work (a passing task once landed at
  // 29.27s). When this env var is set it is passed as an explicit operator
  // override, which the runner prefers over task config. Unset in CI, so mock
  // per-task budgets are untouched.
  const envTimeout = Number(process.env.ANVIL_EVAL_TIMEOUT_MS);
  const timeoutOverride =
    Number.isFinite(envTimeout) && envTimeout > 0 ? envTimeout : undefined;

  // 26.3: free-tier rate-limit pacing is applied by the runner between tasks
  // via `betweenTaskDelayMs` (below) — see runAllEvalTasks.

  const report = await runAllEvalTasks({
    tasksDir: TASKS_DIR,
    fastOnly,
    taskFilter,
    useMock,
    providerId,
    modelId,
    guardian,
    timeoutMs: timeoutOverride,
    // 26.3: free-tier rate-limit pacing. Back-to-back tasks on a capped
    // provider (15–20 req/min) die on HTTP 429 before the model can work;
    // the runner sleeps this long between tasks (never after the last one).
    // 0 in mock/CI so offline runs stay instant.
    betweenTaskDelayMs: !useMock && EVAL_RATE_LIMIT_DELAY_MS > 0 ? EVAL_RATE_LIMIT_DELAY_MS : 0,
    onTaskStart: (task, index, total) => {
      process.stdout.write(`[${index}/${total}] ${task.id} (${task.name})... `);
    },
    onTaskComplete: (result) => {
      const glyph = result.passed ? "PASS ✓" : "FAIL ✗";
      console.log(`${glyph} (${(result.wallClockMs / 1000).toFixed(2)}s, ${result.toolCalls} tools)`);
    },
  });

  console.log("\n" + formatEvalReport(report));

  if (report.passedCount < report.totalTasks) {
    console.error(`\n[eval] FAILED: ${report.totalTasks - report.passedCount} task(s) failed.`);
    process.exit(1);
  } else {
    console.log(`\n[eval] SUCCESS: All ${report.totalTasks} task(s) passed!`);
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("[eval] Fatal Error:", err);
  process.exit(1);
});
