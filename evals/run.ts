#!/usr/bin/env node
/**
 * Phase 17: Verification Harness CLI Runner
 * Run benchmarks locally or in CI:
 *   npx tsx evals/run.ts [--mock] [--fast] [--filter <name>] [--report]
 *   npx tsx evals/run.ts --provider gemini --model gemini-2.0-flash
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  runAllEvalTasks,
  formatEvalReport,
  formatTrendComparison,
  loadRecentReports,
  resolveEvalsDir,
} from "../packages/core/src/eval/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TASKS_DIR = path.join(__dirname, "tasks");

async function main() {
  const args = process.argv.slice(2);

  // 1. Report Mode: Print historical trends
  if (args.includes("--report")) {
    const reports = loadRecentReports(resolveEvalsDir(), 10);
    console.log(formatTrendComparison(reports));
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

  console.log("===============================================================================");
  console.log(" ANVIL EVALUATION HARNESS — Starting Task Run");
  console.log(` Provider: ${useMock ? "mock (offline deterministic)" : providerId} | Model: ${modelId || (useMock ? "eval-mock" : "default")}`);
  console.log(` Tasks Directory: ${TASKS_DIR}`);
  if (fastOnly) console.log(" Filter: fast tasks only");
  if (taskFilter) console.log(` Filter: matching "${taskFilter}"`);
  console.log("===============================================================================");

  const report = await runAllEvalTasks({
    tasksDir: TASKS_DIR,
    fastOnly,
    taskFilter,
    useMock,
    providerId,
    modelId,
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
