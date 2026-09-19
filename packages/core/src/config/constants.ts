/**
 * Centralized core operational constants.
 * Enforces Constitution Rule: NO Hardcoded Magic Constants.
 */

function getEnvNumber(key: string, defaultVal: number): number {
  const val = Number(process.env[key]);
  return Number.isFinite(val) && val > 0 ? val : defaultVal;
}

// Tool Execution Limits
export const MAX_READ_FILE_BYTES = getEnvNumber("ANVIL_MAX_READ_BYTES", 512 * 1024); // 512 KB
export const RUN_COMMAND_TIMEOUT_MS = getEnvNumber("ANVIL_RUN_COMMAND_TIMEOUT_MS", 120_000); // 2 minutes default command timeout
export const MIN_COMMAND_TIMEOUT_MS = 1_000; // 1 second lower bound
export const MAX_COMMAND_TIMEOUT_MS = 600_000; // 10 minutes upper bound
export const MAX_STREAM_BYTES = getEnvNumber("ANVIL_MAX_STREAM_BYTES", 20 * 1024); // 20 KB captured output per stream

// Context Window & Compaction Thresholds
export const FALLBACK_CONTEXT_WINDOW = getEnvNumber("ANVIL_FALLBACK_CONTEXT_WINDOW", 32_000);
export const COMPACTION_TOKEN_THRESHOLD = 80_000;
export const COMPACTION_THRESHOLD = Number(process.env.ANVIL_COMPACTION_THRESHOLD) || 0.75;
export const KEEP_RECENT_MESSAGES = getEnvNumber("ANVIL_KEEP_RECENT_MESSAGES", 6);
export const DEFAULT_MAX_TOKENS = 4096;

// Agent Iteration & Verification Budgets
export const DEFAULT_MAX_INNER_ITERATIONS = getEnvNumber("ANVIL_MAX_INNER_ITERATIONS", 20);
export const MAX_VERIFY_REPAIRS = getEnvNumber("ANVIL_MAX_VERIFY_REPAIRS", 2);

// Eval harness per-task wall-clock budget. Multi-tool coding tasks on a queued
// or free-tier provider routinely exceed the old hardcoded 30s, which reported
// quota/queue latency as task failure. Env-overridable so the live-eval lane can
// raise it without a code change.
export const EVAL_TASK_TIMEOUT_MS = getEnvNumber("ANVIL_EVAL_TIMEOUT_MS", 30_000);

// Checkpoint & History Retention Limits
export const CHECKPOINT_KEEP = getEnvNumber("ANVIL_CHECKPOINT_KEEP", 5);

// MCP Limits
export const DEFAULT_MCP_REQUEST_TIMEOUT_MS = getEnvNumber("ANVIL_MCP_TIMEOUT_MS", 30_000);

// SSE transport connect policy: bounded retries with exponential backoff
// inside the boot/reconnect timeout budget (server keepalives hold idle streams).
export const SSE_CONNECT_MAX_RETRIES = getEnvNumber("ANVIL_SSE_CONNECT_RETRIES", 3);
export const SSE_CONNECT_INITIAL_DELAY_MS = getEnvNumber("ANVIL_SSE_CONNECT_RETRY_MS", 500);
export const SSE_CONNECT_MAX_DELAY_MS = getEnvNumber("ANVIL_SSE_CONNECT_RETRY_MAX_MS", 8_000);

// Subagent Limits
export const SUB_AGENT_REPORT_MAX_CHARS = getEnvNumber("ANVIL_MAX_SUBAGENT_REPORT_CHARS", 8000);

// Compaction summarizer input shaping: tool payloads are stripped before the
// summarizer call, keeping only short error excerpts (outcomes live in text).
export const SUMMARIZER_TOOL_ERROR_MAX_CHARS = getEnvNumber("ANVIL_SUMMARIZER_TOOL_ERROR_CHARS", 500);

// Provider streaming retry policy
export const PROVIDER_STREAM_MAX_RETRIES = getEnvNumber("ANVIL_PROVIDER_STREAM_RETRIES", 2);

// Rate Limiting & Retry Policy
export const RATE_LIMIT_MAX_RETRIES = 3;
export const RATE_LIMIT_INITIAL_DELAY_MS = 1000;
export const RATE_LIMIT_MAX_DELAY_MS = 30_000;

// Subagent & Orchestration Depth Limits
export const MAX_SUBAGENT_DEPTH = 3;
export const MAX_CONCURRENT_SUBAGENTS = 5;

// Session Review Baseline Bounds
export const BASELINE_MAX_PATHS = 200;
export const BASELINE_MAX_BYTES = 8 * 1024 * 1024; // 8 MB total snapshot bytes

// Guardian Gate Verification Defaults
export const DEFAULT_GATE_TIMEOUT_MS = 180_000; // 3 minutes timeout per gate step

// Phase DW-4 — Terminal Platform
export const LONG_TURN_NOTIFY_MS = getEnvNumber("ANVIL_NOTIFY_AFTER_MS", 60_000);
export const CLIPBOARD_MAX_BYTES = getEnvNumber("ANVIL_CLIPBOARD_MAX_BYTES", 100 * 1024);
export const TOKEN_HISTORY_CAP = getEnvNumber("ANVIL_TOKEN_HISTORY_CAP", 24);

// TUI / UI / UX Performance & Responsiveness Constraints
export const TUI_FRAME_RATE_HZ = 60;
export const TUI_STREAM_THROTTLE_MS = 16; // ~60 FPS token stream buffer
export const MIN_TERMINAL_COLUMNS = 60; // Minimum responsive column budget

// Phase 25 — Next-Gen Evolution (v1.0.0)
export const TEAM_MAX_AGENTS = getEnvNumber("ANVIL_TEAM_MAX_AGENTS", 5);
export const TEAM_DEFAULT_ITERATIONS = getEnvNumber("ANVIL_TEAM_ITERATIONS", 12);
export const LSP_REQUEST_TIMEOUT_MS = getEnvNumber("ANVIL_LSP_TIMEOUT_MS", 15_000);
export const LSP_MAX_DIAGNOSTICS = getEnvNumber("ANVIL_LSP_MAX_DIAGNOSTICS", 100);
export const PLUGIN_MAX_TOOLS = getEnvNumber("ANVIL_PLUGIN_MAX_TOOLS", 20);
export const CONTEXT_WARN_THRESHOLD = Number(process.env.ANVIL_CONTEXT_WARN_THRESHOLD) || 0.6;
export const GUARDIAN_MAX_AUTO_FIXES = getEnvNumber("ANVIL_GUARDIAN_MAX_FIXES", 10);

// Phase 26.2 — `anvil gate --watch` debounce + rate bound (no magic numbers).
export const GUARDIAN_WATCH_INTERVAL_MS = getEnvNumber("ANVIL_GUARDIAN_WATCH_MS", 500);
export const GUARDIAN_WATCH_MAX_SCANS_PER_MIN = getEnvNumber("ANVIL_GUARDIAN_WATCH_MAX_SCANS", 60);
