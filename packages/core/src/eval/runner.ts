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
          timeoutMs: config.timeoutMs || 30_000,
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

    // 3. Run AgentSession against tempDir
    const session = new AgentSession(provider, {
      projectRoot: tempDir,
      model: modelId,
      maxTokens: task.maxTokens || 4096,
      systemPrompt: "You are Anvil, an expert coding agent. Fulfill the user request accurately.",
      permissionBroker: AUTO_APPROVE_BROKER,
      autoVerify: false,
    });

    const timeoutLimit = options.timeoutMs || task.timeoutMs || 30_000;
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

    // 4. Run assertion script
    // Ensure check.sh is executable
    try {
      fs.chmodSync(task.assertionScript, 0o755);
    } catch {}

    const checkResult = spawnSync("bash", [task.assertionScript], {
      cwd: tempDir,
      timeout: 10_000,
      env: { ...process.env, PROJECT_ROOT: tempDir },
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
  } catch (err: any) {
    passed = false;
    errorMsg = err?.message || String(err);
  } finally {
    // Cleanup workspace
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
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

  const results: EvalResult[] = [];
  const total = tasks.length;

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    options.onTaskStart?.(task, i + 1, total);
    const result = await runEvalTask(task, options);
    results.push(result);
    options.onTaskComplete?.(result, i + 1, total);
  }

  const providerName = options.useMock || !options.providerId ? "mock" : options.providerId;
  const modelName = options.modelId || (options.useMock ? "eval-mock" : "default");

  const report = createEvalReport(results, modelName, providerName);
  await saveEvalReport(report, options.outputDir);
  return report;
}
