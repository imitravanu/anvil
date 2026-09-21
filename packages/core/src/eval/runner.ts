import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { EvalTask, EvalResult, EvalReport, EvalRunnerOptions } from "./types.js";
import { createEvalReport, saveEvalReport } from "./report.js";
import { createEvalMockProvider } from "./mockProvider.js";
import { AgentSession } from "../agent/session.js";
import { AUTO_APPROVE_BROKER } from "../agent/types.js";
import { ModelProvider } from "../providers/types.js";
import { createProviders } from "../providers/index.js";
import { loadCredentials } from "../config/index.js";
import { getErrorMessage, sleepAbortable } from "../errors.js";
import { scanTextForSlop } from "../guardian/scanner.js";
import { EVAL_CONCURRENCY_DEFAULT, EVAL_CONCURRENCY_MAX, EVAL_TASK_TIMEOUT_MS } from "../config/constants.js";

/**
 * Phase 27.1 — normalize a requested worker count. Non-numeric, fractional,
 * and out-of-range values clamp into [1, EVAL_CONCURRENCY_MAX]; undefined
 * means "not asked" and stays single-flight (mock determinism preserved).
 */
export function resolveConcurrency(raw: unknown): number {
  const n = typeof raw === "string" ? Number(raw) : (raw as number);
  if (!Number.isFinite(n)) return EVAL_CONCURRENCY_DEFAULT;
  return Math.min(EVAL_CONCURRENCY_MAX, Math.max(1, Math.floor(n)));
}

/**
 * Phase 27.1 — bounded worker pool without dependencies. Results land in
 * input order regardless of completion order (the shared counter hands out
 * indices synchronously, so no two workers ever share one). A rejection in
 * one worker fails the map — eval tasks never reject (runEvalTask converts
 * everything into a failed EvalResult), so one bad task can never sink the
 * rest of the run; that isolation is asserted, not assumed.
 */
export async function mapWithConcurrencyLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workerCount = Math.min(Math.max(1, limit), Math.max(items.length, 1));
  const workers = Array.from({ length: workerCount }, async () => {
    for (;;) {
      const i = next;
      next += 1;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * Discovers and parses all valid eval tasks under tasksDir.
 */
export function loadEvalTasks(tasksDir: string): EvalTask[] {
  if (!fs.existsSync(tasksDir)) {
    return [];
  }

  const entries = fs.readdirSync(tasksDir, { withFileTypes: true });
  const tasks: EvalTask[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const taskDir = path.join(tasksDir, entry.name);
    const configPath = path.join(taskDir, "task.json");
    const setupDir = path.join(taskDir, "setup");
    const assertionScript = path.join(taskDir, "assertions", "check.sh");

    if (fs.existsSync(configPath) && fs.existsSync(setupDir) && fs.existsSync(assertionScript)) {
      try {
        const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
        tasks.push({
          id: entry.name,
          name: config.name || entry.name,
          category: config.category || "feature",
          prompt: config.prompt || "",
          timeoutMs: config.timeoutMs || EVAL_TASK_TIMEOUT_MS,
          maxTokens: config.maxTokens,
          fast: config.fast ?? true,
          taskDir,
          setupDir,
          assertionScript,
        });
      } catch {
        // ignore invalid task.json
      }
    }
  }

  return tasks.sort((a, b) => a.id.localeCompare(b.id));
}

function copyDirRecursive(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Runs a single evaluation task in an isolated temporary directory.
 */
export async function runEvalTask(
  task: EvalTask,
  options: EvalRunnerOptions = {}
): Promise<EvalResult> {
  const startTime = Date.now();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `anvil-eval-${task.id}-`));

  let toolCalls = 0;
  let tokensUsed = { input: 0, output: 0 };
  let passed = false;
  let errorMsg: string | undefined;

  try {
    // 1. Prepare isolated workspace
    copyDirRecursive(task.setupDir, tempDir);

    // 2. Resolve provider
    let provider: ModelProvider;
    let modelId = options.modelId || "mock-model";

    if (options.useMock || !options.providerId) {
      provider = createEvalMockProvider(task);
      modelId = "eval-mock";
    } else {
      const creds = loadCredentials();
      const allProviders = createProviders(creds);
      const chosen = (allProviders as Record<string, ModelProvider>)[options.providerId];
      if (!chosen || !chosen.isConfigured()) {
        throw new Error(`Provider ${options.providerId} is not configured or unknown.`);
      }
      provider = chosen;
    }

    // 3. Run AgentSession against tempDir — seeded with the guardian toggle so
    // the 26.3 matrix can measure the same task with only the interceptor off.
    const session = new AgentSession(provider, {
      projectRoot: tempDir,
      model: modelId,
      maxTokens: task.maxTokens || 4096,
      systemPrompt: "You are Anvil, an expert coding agent. Fulfill the user request accurately.",
      permissionBroker: AUTO_APPROVE_BROKER,
      autoVerify: false,
      ...(options.guardian === undefined ? {} : { guardian: options.guardian }),
    });

    const timeoutLimit = options.timeoutMs || task.timeoutMs || EVAL_TASK_TIMEOUT_MS;
    const abortController = new AbortController();
    // The old code aborted this controller but never wired it into the turn:
    // session.send() owns its own controller, so a hung provider stalled the
    // `for await` forever and the timeout never fired. Cancelling the session
    // aborts the in-flight provider stream, which unwinds the loop promptly.
    const timeoutHandle = setTimeout(() => {
      abortController.abort();
      session.cancel();
    }, timeoutLimit);

    try {
      for await (const event of session.send(task.prompt)) {
        if (abortController.signal.aborted) {
          throw new Error(`Task timed out after ${timeoutLimit}ms`);
        }
        if (event.type === "tool_finished") {
          toolCalls++;
        } else if (event.type === "usage") {
          tokensUsed.input += event.inputTokens;
          tokensUsed.output += event.outputTokens;
        } else if (event.type === "error") {
          errorMsg = event.message;
        }
      }
    } finally {
      clearTimeout(timeoutHandle);
    }

    // 3.5. Advisory slop scan of generated source files
    const slopViolations: Array<{ file: string; line: number; rule: string; detail: string }> = [];
    function walkForSlop(dir: string) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules") continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walkForSlop(full);
        } else if (/\.(ts|tsx|js)$/.test(entry.name)) {
          const content = fs.readFileSync(full, "utf8");
          // "anvil" scope: the eval harness judges the agent against Anvil's own
          // conventions, so its rule families are the right ones here even though
          // the scanned files live in a temp dir.
          slopViolations.push(...scanTextForSlop(full, content, "anvil"));
        }
      }
    }
    walkForSlop(tempDir);
    if (slopViolations.length > 0) {
      console.warn(`[eval:${task.id}] Slop violations detected (${slopViolations.length}):`);
      for (const v of slopViolations) {
        console.warn(`  ${v.file}:${v.line} [${v.rule}] ${v.detail}`);
      }
    }

    // 4. Run assertion script
    // Ensure check.sh is executable
    try {
      fs.chmodSync(task.assertionScript, 0o755);
    } catch {
      // intentional: chmod is best-effort; a missing exec bit surfaces in the
      // assertion run below as a real error instead
    }

    const checkResult = spawnSync("bash", [task.assertionScript], {
      cwd: tempDir,
      timeout: 10_000,
      env: {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        LANG: process.env.LANG ?? "",
        USER: process.env.USER ?? "",
        LOGNAME: process.env.LOGNAME ?? "",
        TMPDIR: process.env.TMPDIR ?? "",
        SHELL: process.env.SHELL ?? "",
        PROJECT_ROOT: tempDir,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    if (checkResult.status === 0) {
      passed = true;
    } else {
      passed = false;
      const stderr = checkResult.stderr?.toString("utf8").trim();
      const stdout = checkResult.stdout?.toString("utf8").trim();
      errorMsg = stderr || stdout || `check.sh failed with exit code ${checkResult.status}`;
    }
  } catch (err: unknown) {
    passed = false;
    errorMsg = getErrorMessage(err);
  } finally {
    // Cleanup workspace
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // intentional: cleanup is best-effort; a leftover temp workspace is
      // acceptable and does not affect the eval result
    }
  }

  const wallClockMs = Date.now() - startTime;
  return {
    taskId: task.id,
    name: task.name,
    category: task.category,
    passed,
    wallClockMs,
    tokensUsed,
    toolCalls,
    error: errorMsg,
  };
}

/**
 * Runs all discovered tasks and produces an aggregated EvalReport.
 */
export async function runAllEvalTasks(
  options: EvalRunnerOptions = {}
): Promise<EvalReport> {
  const defaultTasksDir = path.resolve(process.cwd(), "evals", "tasks");
  const tasksDir = options.tasksDir || defaultTasksDir;
  let tasks = loadEvalTasks(tasksDir);

  if (options.fastOnly) {
    tasks = tasks.filter((t) => t.fast);
  }
  if (options.taskFilter) {
    const filter = options.taskFilter.toLowerCase();
    tasks = tasks.filter((t) => t.id.toLowerCase().includes(filter) || t.name.toLowerCase().includes(filter));
  }

  const results: EvalResult[] = new Array(tasks.length);
  const total = tasks.length;
  const concurrency = resolveConcurrency(options.concurrency);
  const delayMs = options.betweenTaskDelayMs && options.betweenTaskDelayMs > 0 ? options.betweenTaskDelayMs : 0;
  // Completions seen so far — a plain counter, because Array.filter skips
  // holes and would read a half-filled slot array as "nothing pending".

  // 27.1: bounded pool. Each worker owns its slot's result index, so the
  // report stays in task order; onTaskStart carries the original index, so
  // progress logs ([i/total]) stay correctly labeled though completion order
  // varies. Pacing is per completion except the final one (exactly tasks-1
  // sleeps, never a trailing wait), so free-tier lanes keep their 429
  // protection under concurrency too.
  let completed = 0;
  await mapWithConcurrencyLimit(tasks, concurrency, async (task, i) => {
    options.onTaskStart?.(task, i + 1, total);
    const result = await runEvalTask(task, options);
    results[i] = result;
    // Increment and test synchronously: exactly every completion but the
    // final one sleeps, whatever the worker interleaving.
    completed += 1;
    const isLast = completed >= total;
    options.onTaskComplete?.(result, i + 1, total);
    if (delayMs > 0 && !isLast) {
      await sleepAbortable(delayMs);
    }
  });

  const providerName = options.useMock || !options.providerId ? "mock" : options.providerId;
  const modelName = options.modelId || (options.useMock ? "eval-mock" : "default");

  const report = createEvalReport(results, modelName, providerName, options.guardian);
  await saveEvalReport(report, options.outputDir);
  return report;
}
