import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { EvalTask, EvalResult, EvalReport, EvalRunnerOptions } from "./types.js";
import { createEvalReport, saveEvalReport } from "./report.js";
import { captureFailureDiff } from "./failureDiff.js";
import { createEvalMockProvider } from "./mockProvider.js";
import { AgentSession } from "../agent/session.js";
import { AUTO_APPROVE_BROKER } from "../agent/types.js";
import { ModelProvider, classifyProviderError } from "../providers/types.js";
import { createProviders } from "../providers/index.js";
import { resolveProviderCredentials } from "../config/index.js";
import { buildAnvilAgentProfile } from "../config/agentProfile.js";
import { getErrorMessage, sleepAbortable } from "../errors.js";
import { scanTextForSlop } from "../guardian/scanner.js";
import { EVAL_ASSERTION_TIMEOUT_MS, EVAL_CONCURRENCY_DEFAULT, EVAL_CONCURRENCY_MAX, EVAL_TASK_TIMEOUT_MS } from "../config/constants.js";
import { log } from "../logger.js";

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
          // Multi-turn: only non-empty strings; a malformed entry is dropped
          // rather than sent as an empty user turn the model cannot act on.
          ...(Array.isArray(config.followUps)
            ? {
                followUps: config.followUps.filter(
                  (t: unknown): t is string => typeof t === "string" && t.trim().length > 0
                ),
              }
            : {}),
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

const EVAL_COPY_EXCLUDED = new Set(["node_modules", "dist", ".git"]);

function copyDirRecursive(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    if (EVAL_COPY_EXCLUDED.has(entry.name)) continue;
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    // lstat guard: never follow symlinked dirs out of the fixture — a
    // poisoned fixture could otherwise copy the host filesystem.
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(srcPath);
    } catch {
      // intentional: raced unlink during copy — skip, the task setup is best-effort.
      continue;
    }
    if (stat.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else if (entry.isFile()) {
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
  /** User turns actually dispatched (A4 multi-turn) — 1 for a single-shot task. */
  let turnsSent = 0;
  let tokensUsed: EvalResult["tokensUsed"] = { input: 0, output: 0, cachedInput: 0 };
  let passed = false;
  let errorMsg: string | undefined;
  let failureDiff: string | undefined;
  // A8: structured failure origin, set at the site that knows it (never inferred
  // from the message by the A/B harness).
  let failureKind: "provider" | "network" | "task" | undefined;
  // Batch Q-prep (2026-10-10): the provider already classified stream deaths
  // (turnStream carries `failureKind` on error events). A run the provider
  // killed is not capability evidence, whatever check.sh then says about the
  // half-finished workspace.
  let streamFailureKind: "provider" | "network" | undefined;

  try {
    // 1. Prepare isolated workspace
    copyDirRecursive(task.setupDir, tempDir);

    // 2. Resolve provider
    let provider: ModelProvider;
    let modelId = options.modelId || "mock-model";

    if (options.provider) {
      // Phase 38.8: a scripted provider for deterministic axis measurement.
      provider = options.provider;
      modelId = options.modelId || "scripted";
    } else if (options.useMock || !options.providerId) {
      provider = createEvalMockProvider(task);
      modelId = "eval-mock";
    } else {
      const creds = resolveProviderCredentials();
      const allProviders = createProviders(creds);
      const chosen = (allProviders as Record<string, ModelProvider>)[options.providerId];
      if (!chosen || !chosen.isConfigured()) {
        throw new Error(`Provider ${options.providerId} is not configured or unknown.`);
      }
      provider = chosen;
    }

    // 3. Run AgentSession against tempDir — seeded with the guardian toggle so
    // the 26.3 matrix can measure the same task with only the interceptor off.
    // The profile is shared with the shipping surfaces so the lane measures the
    // agent users actually run. autoVerify stays OFF here on purpose: a repair
    // loop changes the trajectory and can mask the failure the task asserts
    // (declared boundary, PHASE-38-ROADMAP.md §4).
    //
    // `options.profile` is the Phase 38.4 A/B seam: an experiment arm supplies
    // the agent's own prompt and budget so two arms of the SAME task set differ
    // only in the thing under test. Undefined keeps the shipping profile, so the
    // default path is unchanged.
    const overrides = options.profile;
    const profile = buildAnvilAgentProfile(tempDir, {
      maxTokens: task.maxTokens,
      autoVerify: false,
    });
    const systemPrompt = overrides?.systemPrompt ?? profile.systemPrompt;
    const session = new AgentSession(provider, {
      projectRoot: tempDir,
      model: modelId,
      maxTokens: overrides?.maxTokens ?? profile.maxTokens,
      systemPrompt,
      permissionBroker: AUTO_APPROVE_BROKER,
      autoVerify: overrides?.autoVerify ?? profile.autoVerify,
      ...(options.guardian === undefined ? {} : { guardian: options.guardian }),
    });

    // A1 (tokens) had a time-shaped twin: a harness cap narrower than the
    // fixture's own budget grades a long-horizon task as a capability failure
    // for a clock the harness chose. `respectTaskTimeout` (both lanes now)
    // takes the MAXIMUM — extend, never truncate.
    const runnerTimeout = options.timeoutMs;
    const taskTimeout = task.timeoutMs;
    const timeoutLimit = options.respectTaskTimeout
      ? Math.max(runnerTimeout ?? 0, taskTimeout ?? 0) || EVAL_TASK_TIMEOUT_MS
      : runnerTimeout || taskTimeout || EVAL_TASK_TIMEOUT_MS;
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
      // Multi-turn (A4): every turn goes to the SAME session, so history
      // accumulates and turn N is graded on what turn N-1 actually left behind.
      // A fresh session per turn would make the follow-up meaningless.
      for (const turnPrompt of [task.prompt, ...(task.followUps ?? [])]) {
        turnsSent += 1;
        for await (const event of session.send(turnPrompt)) {
          if (abortController.signal.aborted) {
            // A8: a timeout is a GRADED outcome (the model may be looping), so
            // the structured origin is "task" — never excused as provider weather.
            failureKind = "task";
            throw new Error(`Task timed out after ${timeoutLimit}ms`);
          }
          if (event.type === "tool_finished") {
            toolCalls++;
          } else if (event.type === "usage") {
            tokensUsed.input += event.inputTokens;
            tokensUsed.output += event.outputTokens;
            // Phase 38.2 contract: cached is a breakdown of `input`, absent when
            // the provider does not report it — never a second input bucket.
            if (typeof event.cachedInputTokens === "number") {
              tokensUsed.cachedInput = (tokensUsed.cachedInput ?? 0) + event.cachedInputTokens;
            }
            if (typeof event.cacheCreationInputTokens === "number") {
              tokensUsed.cacheCreationInput = (tokensUsed.cacheCreationInput ?? 0) + event.cacheCreationInputTokens;
            }
          } else if (event.type === "error") {
            errorMsg = event.message;
            // A8 done at the source: the provider classified the failure, so a
            // provider-killed run is never graded as a capability failure below.
            if (event.failureKind) streamFailureKind = event.failureKind;
          }
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
      log.warn(`[eval:${task.id}] Slop violations detected (${slopViolations.length}):`);
      for (const v of slopViolations) {
        log.warn(`  ${v.file}:${v.line} [${v.rule}] ${v.detail}`);
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
      timeout: EVAL_ASSERTION_TIMEOUT_MS,
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
      // A8: an assertion failure is a TASK failure by construction — UNLESS the
      // provider killed the run first (rate limits, 5xx, auth): a compromised
      // trajectory is not capability evidence, and the A/B harness excludes it
      // from significance via the structured kind. Without this, an outage was
      // graded as "the model is bad at coding".
      failureKind = streamFailureKind ?? "task";
      const stderr = checkResult.stderr?.toString("utf8").trim();
      const stdout = checkResult.stdout?.toString("utf8").trim();
      errorMsg = stderr || stdout || `check.sh failed with exit code ${checkResult.status}`;
    }
  } catch (err: unknown) {
    passed = false;
    errorMsg = getErrorMessage(err);
    // A8: classify at the site that holds the thrown object. Known provider/
    // network classes are infrastructure; UNKNOWN stays unclassified — a
    // harness error (sandbox copy, spawn) is not provider weather either.
    const cls = classifyProviderError(err);
    failureKind =
      cls.code === "UNKNOWN" ? undefined : cls.code === "NETWORK_TIMEOUT" ? "network" : "provider";
  } finally {
    // 27.3: capture WHAT the model wrote BEFORE the sandbox is destroyed — the
    // diff is the diagnostic, and it is discarded with the temp dir otherwise.
    // Failure-only (a passing task's diff is noise). Best-effort: a capture
    // error must never change the task's pass/fail.
    if (!passed) {
      try {
        const diff = captureFailureDiff(task.setupDir, tempDir);
        if (diff) failureDiff = diff;
      } catch {
        // intentional: capture is diagnostic; its failure is not a task failure
      }
    }
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
    turns: turnsSent,
    wallClockMs,
    tokensUsed,
    toolCalls,
    error: errorMsg,
    ...(failureKind ? { failureKind } : {}),
    ...(failureDiff ? { failureDiff } : {}),
  };
}

/**
 * Shared task-filter semantics for every eval lane: case-insensitive match on
 * the task id OR its name. `--filter Multifile` used to select zero tasks in
 * the A/B lane (id-only, case-sensitive) while the batch runner matched more
 * (AUDIT-2026-09-30 A5).
 */
export function matchesTaskFilter(task: EvalTask, filter: string): boolean {
  const needle = filter.toLowerCase();
  return task.id.toLowerCase().includes(needle) || task.name.toLowerCase().includes(needle);
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
  const taskFilter = options.taskFilter;
  if (taskFilter) {
    tasks = tasks.filter((t) => matchesTaskFilter(t, taskFilter));
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
