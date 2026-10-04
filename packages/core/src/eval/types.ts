/**
 * Phase 17: Verification Harness (Agent Evals) Types
 * Per docs/ANVIL-COMPLETE-ROADMAP.md Section 6.2
 */

import type { ModelProvider } from "../providers/types.js";

export interface EvalTaskConfig {
  name: string;
  category: "bugfix" | "feature" | "migration" | "regression" | "multifile" | "config";
  prompt: string;
  timeoutMs: number;
  maxTokens?: number;
  fast?: boolean;
}

export interface EvalTask extends EvalTaskConfig {
  id: string;
  taskDir: string;
  setupDir: string;
  assertionScript: string;
}

export interface EvalResult {
  taskId: string;
  name: string;
  category: string;
  passed: boolean;
  wallClockMs: number;
  tokensUsed: { input: number; output: number };
  toolCalls: number;
  error?: string;
  /**
   * A8 (AUDIT-2026-09-30): the STRUCTURED origin of a failure, set where the
   * failure actually happens. The A/B harness prefers this over regexing the
   * message, so a graded assertion whose text happens to contain "unavailable"
   * (or any environmental word) can never be excused as a provider error.
   * Undefined means the origin was not structurally known — the message
   * classifier's legacy path still applies.
   */
  failureKind?: "provider" | "network" | "task";
  /**
   * USD cost of this task's tokens (27.5), or undefined when the model's price
   * is unknown — never 0 as a stand-in for unknown.
   */
  estimatedCostUsd?: number;
  /**
   * Unified diff of what the model changed on a FAILED task (27.3), capped.
   * Absent when the task passed or the workspace was left unchanged.
   */
  failureDiff?: string;
}

export interface EvalReport {
  date: string;
  timestamp: number;
  model: string;
  provider: string;
  /** Whether the guardian interceptor was ON for this run (26.3). */
  guardian?: boolean;
  results: EvalResult[];
  passRate: number; // 0 to 1
  passedCount: number;
  totalTasks: number;
  totalWallClockMs: number;
  totalTokens: { input: number; output: number };
  /**
   * Total USD cost (27.5). Undefined when ANY task's model price was unknown,
   * so a partial sum is never presented as the run total. `unpricedTasks`
   * counts those tasks for display.
   */
  estimatedCostUsd?: number;
  unpricedTasks?: number;
}

export interface EvalRunnerOptions {
  tasksDir?: string;
  outputDir?: string;
  fastOnly?: boolean;
  taskFilter?: string;
  timeoutMs?: number;
  /**
   * Phase A4 follow-up: never let `timeoutMs` truncate a budget the FIXTURE
   * declares. `options.timeoutMs` normally overrides `task.timeoutMs`, which is
   * right for the eval CLI (one clock for the whole run) and wrong for an A/B
   * arm: the harder tier budgets 180s per task on purpose, and a harness cap of
   * 120s grades a long-horizon task as a capability failure for a clock nobody
   * shipped. The time-shaped twin of AUDIT A1's 4,096-token cap. With this set,
   * the effective limit is the MAXIMUM of the two — extend, never truncate.
   */
  respectTaskTimeout?: boolean;
  useMock?: boolean;
  /**
   * Phase 38.8 measurement seam: a fully scripted provider, bypassing both the
   * mock fixture provider and live credential resolution. Exists so the
   * verification axis (autoVerify on/off) can be measured deterministically
   * through the real session path — see eval/scriptedVerifyProvider.ts.
   */
  provider?: ModelProvider;
  providerId?: string;
  modelId?: string;
  /**
   * Guardian toggle for the proof matrix (26.3). Default ON — matches product
   * behavior. An explicit false seeds every task's session with the guardian
   * disabled, so the same task/seed measures the delta the interceptor makes.
   */
  guardian?: boolean;
  /**
   * Phase 38.4 A/B seam: replace the agent's own prompt and budget for this
   * run. Undefined keeps the shipping profile (the default path, unchanged), so
   * an experiment arm differs from a normal eval task only in the thing under
   * test.
   */
  profile?: {
    systemPrompt?: string;
    maxTokens?: number;
    autoVerify?: boolean;
  };
  /**
   * 26.3 free-tier pacing: milliseconds to sleep BETWEEN tasks (never after
   * the last one). 0/undefined keeps the run instant (mock/CI default).
   * Under concurrency (27.1) each worker paces its OWN tasks.
   */
  betweenTaskDelayMs?: number;
  /**
   * 27.1 parallel live execution: how many tasks run at once (1–8).
   * Default 1 — mock stays deterministic and live stays sequential unless
   * asked. Out-of-range/non-numeric values clamp to the valid range (see
   * resolveConcurrency). Report results stay in task order regardless.
   */
  concurrency?: number;
  onTaskStart?: (task: EvalTask, index: number, total: number) => void;
  onTaskComplete?: (result: EvalResult, index: number, total: number) => void;
}
