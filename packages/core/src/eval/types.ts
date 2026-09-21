/**
 * Phase 17: Verification Harness (Agent Evals) Types
 * Per docs/ANVIL-COMPLETE-ROADMAP.md Section 6.2
 */

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
}

export interface EvalRunnerOptions {
  tasksDir?: string;
  outputDir?: string;
  fastOnly?: boolean;
  taskFilter?: string;
  timeoutMs?: number;
  useMock?: boolean;
  providerId?: string;
  modelId?: string;
  /**
   * Guardian toggle for the proof matrix (26.3). Default ON — matches product
   * behavior. An explicit false seeds every task's session with the guardian
   * disabled, so the same task/seed measures the delta the interceptor makes.
   */
  guardian?: boolean;
  /**
   * 26.3 free-tier pacing: milliseconds to sleep BETWEEN tasks (never after
   * the last one). 0/undefined keeps the run instant (mock/CI default).
   */
  betweenTaskDelayMs?: number;
  onTaskStart?: (task: EvalTask, index: number, total: number) => void;
  onTaskComplete?: (result: EvalResult, index: number, total: number) => void;
}
