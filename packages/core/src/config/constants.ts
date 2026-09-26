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

// Streaming "thinking" indicator tick (Phase 28.4). One second is the smallest
// interval that reads as a clock rather than a jitter, and it bounds the
// re-render rate for a message that has no text yet.
export const THINKING_TIMER_TICK_MS = 1000;

// Animated wordmark (Phase 28.5) — boot-animation timing, ported from the
// anvil-ui-demo prototype's literals, now named and centralised.
export const WORDMARK_ANIM_DURATION_MS = 1800;
/** Frame interval of the boot animation (20 fps for ~1.8s, then it stops). */
export const WORDMARK_ANIM_FRAME_MS = 50;
/** Delay before the dot of the "i" starts flashing. */
export const WORDMARK_SPARK_DELAY_MS = 80;
/** Delay before the letters begin to ignite, after the spark. */
export const WORDMARK_LETTER_START_MS = 250;
/** How long a pixel takes to cool from hottest to the ramp's base. */
export const WORDMARK_COOL_DURATION_MS = 700;
/** Per-cell radial delay — the ignition wave spreads this many ms per cell. */
export const WORDMARK_RADIAL_CELL_MS = 30;

// Token estimation. ~4 chars/token is right for ASCII source and prose, but a
// wide-script character (CJK/Kana/Hangul) costs roughly a token BY ITSELF, so a
// flat chars/4 under-counts those histories by ~4x and compaction fires far too
// late — the turn then dies on the provider's context limit instead.
export const ASCII_CHARS_PER_TOKEN = 4;
export const CJK_TOKENS_PER_CHAR = 1;
/** Fixed cost per attached image (a full-bleed vision image is ≥ ~1.5k). */
export const IMAGE_TOKEN_ESTIMATE = 2_000;

// Context-relevance scoring weights (selectiveKeep keeps the highest scorers).
export const SCORE_WEIGHT_KEYWORD = 0.5;
export const SCORE_WEIGHT_RECENCY = 0.3;
export const SCORE_WEIGHT_FILE = 0.2;

// Session token calibration: a session learns measured/estimated from the
// provider's own usage events and applies the factor to later estimates. Clamped
// so one odd provider response cannot make compaction fire (or never fire).
export const TOKEN_CALIBRATION_MIN = 0.5;
export const TOKEN_CALIBRATION_MAX = 2;
export const TOKEN_CALIBRATION_SMOOTHING = 0.5;

// Agent Iteration & Verification Budgets
export const DEFAULT_MAX_INNER_ITERATIONS = getEnvNumber("ANVIL_MAX_INNER_ITERATIONS", 20);
export const MAX_VERIFY_REPAIRS = getEnvNumber("ANVIL_MAX_VERIFY_REPAIRS", 2);

// Eval harness per-task wall-clock budget. Multi-tool coding tasks on a queued
// or free-tier provider routinely exceed the old hardcoded 30s, which reported
// quota/queue latency as task failure. Env-overridable so the live-eval lane can
// raise it without a code change.
export const EVAL_TASK_TIMEOUT_MS = getEnvNumber("ANVIL_EVAL_TIMEOUT_MS", 30_000);

// Phase 27.3 — failure diff capture: a failed task's unified diff is model-authored
// and bounded so a runaway write cannot bloat the report or the persisted .diff.
export const EVAL_FAILURE_DIFF_MAX_CHARS = getEnvNumber("ANVIL_EVAL_FAILURE_DIFF_CHARS", 8_000);

// Phase 26.3 — free-tier rate-limit pacing: delay inserted BETWEEN eval tasks on
// live providers. Free tiers allow 15–20 req/min; back-to-back tasks die on
// HTTP 429 before the model can work. Mock runs ignore it entirely (0).
export const EVAL_RATE_LIMIT_DELAY_MS = getEnvNumber("ANVIL_EVAL_RATE_LIMIT_DELAY_MS", 2_000);

// Checkpoint & History Retention Limits
export const CHECKPOINT_KEEP = getEnvNumber("ANVIL_CHECKPOINT_KEEP", 5);

// MCP Limits
export const DEFAULT_MCP_REQUEST_TIMEOUT_MS = getEnvNumber("ANVIL_MCP_TIMEOUT_MS", 30_000);

// SSE transport connect policy: bounded retries with exponential backoff
// inside the boot/reconnect timeout budget (server keepalives hold idle streams).
export const SSE_CONNECT_MAX_RETRIES = getEnvNumber("ANVIL_SSE_CONNECT_RETRIES", 3);
export const SSE_CONNECT_INITIAL_DELAY_MS = getEnvNumber("ANVIL_SSE_CONNECT_RETRY_MS", 500);
export const SSE_CONNECT_MAX_DELAY_MS = getEnvNumber("ANVIL_SSE_CONNECT_RETRY_MAX_MS", 8_000);

// MCP transport retention bounds. The pump queue is what holds server messages
// no reader has consumed yet, so a flooding (or broken) remote server could
// otherwise grow the agent's memory without limit. Capped by BOTH count and
// bytes; overflow fails the transport so pending calls error as closed instead
// of messages being dropped silently.
export const MCP_MAX_PUMP_QUEUE_LINES = getEnvNumber("ANVIL_MCP_QUEUE_LINES", 1_000);
export const MCP_MAX_PUMP_QUEUE_BYTES = getEnvNumber("ANVIL_MCP_QUEUE_BYTES", 8 * 1024 * 1024);

// Subagent Limits
export const SUB_AGENT_REPORT_MAX_CHARS = getEnvNumber("ANVIL_MAX_SUBAGENT_REPORT_CHARS", 8000);

// Compaction summarizer input shaping: tool payloads are stripped before the
// summarizer call, keeping only short error excerpts (outcomes live in text).
export const SUMMARIZER_TOOL_ERROR_MAX_CHARS = getEnvNumber("ANVIL_SUMMARIZER_TOOL_ERROR_CHARS", 500);

// Provider streaming retry policy
export const PROVIDER_STREAM_MAX_RETRIES = getEnvNumber("ANVIL_PROVIDER_STREAM_RETRIES", 2);

// Tool-call JSON provenance: a malformed tool-arguments buffer is model-authored
// and unbounded, so the excerpt carried in the `__parseError` sentinel is capped
// — the model-visible error must stay small enough to re-send on the retry.
export const TOOL_CALL_RAW_INPUT_CAP = getEnvNumber("ANVIL_TOOL_CALL_RAW_CAP", 200);

// Phase 27.1 — parallel live execution bounds (no magic numbers). Mock runs
// stay single-flight for determinism; live lanes scale to 8 workers.
export const EVAL_CONCURRENCY_DEFAULT = 1;
export const EVAL_CONCURRENCY_MAX = 8;

// Inception Mercury burns ~250 reasoning tokens before emitting anything
// (measured 252 on a live tool probe 2026-09-21), so small caller budgets
// (e.g. a 50-token cert probe) return empty length-cutoff turns without a
// floor. Env-overridable per the no-magic-constants rule.
export const INCEPTION_MIN_COMPLETION_TOKENS = getEnvNumber("ANVIL_INCEPTION_MIN_TOKENS", 1_024);

// Rate Limiting & Retry Policy
export const RATE_LIMIT_MAX_RETRIES = 3;
export const RATE_LIMIT_INITIAL_DELAY_MS = 1000;
export const RATE_LIMIT_MAX_DELAY_MS = 30_000;

// Subagent & Orchestration Depth Limits
export const MAX_SUBAGENT_DEPTH = 3;
export const MAX_CONCURRENT_SUBAGENTS = 5;

// Session search (`/session search <text>`): matches message TEXT only — a
// tool_result is a file/command dump, so matching it would make every session
// that ever read a file hit any filename query. Both the result and snippet
// counts are capped so an explicit search stays cheap on a large sessions dir.
export const SESSION_SEARCH_MIN_QUERY_CHARS = 2;
export const SESSION_SEARCH_MAX_RESULTS = 20;
export const SESSION_SEARCH_MAX_SNIPPETS = 3;
export const SESSION_SEARCH_SNIPPET_CHARS = 80;

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
/** Per-tool argv length in the shell-free plugin form. */
export const PLUGIN_MAX_ARGS = getEnvNumber("ANVIL_PLUGIN_MAX_ARGS", 16);
export const CONTEXT_WARN_THRESHOLD = Number(process.env.ANVIL_CONTEXT_WARN_THRESHOLD) || 0.6;
export const GUARDIAN_MAX_AUTO_FIXES = getEnvNumber("ANVIL_GUARDIAN_MAX_FIXES", 10);

// Phase 26.2 — `anvil gate --watch` debounce + rate bound (no magic numbers).
export const GUARDIAN_WATCH_INTERVAL_MS = getEnvNumber("ANVIL_GUARDIAN_WATCH_MS", 500);
export const GUARDIAN_WATCH_MAX_SCANS_PER_MIN = getEnvNumber("ANVIL_GUARDIAN_WATCH_MAX_SCANS", 60);

// ── AUDIT-11 (2026-09-28) — caps migrated from their consumer modules ────────
// Constitution §2.4: cap-shaped constants live here, not beside the code they
// bound. The defining modules re-export these names so their public API and
// every import site stay unchanged. A conformance test in config/__tests__
// fails if a cap-shaped export reappears outside this file (or the TUI's
// displayLimits.ts, its display-budget equivalent).

// CLI headless (`anvil -p`) stdin intake bounds.
export const MAX_STDIN_BYTES = 1024 * 1024; // 1 MB cap
export const MAX_STDIN_WAIT_MS = 30_000; // 30s hard timeout

// MCP transport retention (transport.ts) and tools/list cursor loop (client.ts).
export const MAX_MCP_LINE_BYTES = 1024 * 1024;
export const MAX_LIST_PAGES = 20;

// Goal engine (agent/goal).
export const MAX_GOAL_TURNS = 10;

// Run ledger (agent/ledger.ts): entries kept per session file.
export const LEDGER_CAP = 1000;

// Sub-agent budgets (agent/subagent.ts).
export const SUB_AGENT_MAX_ITERATIONS = 12;
export const SUB_AGENT_MAX_TOKENS = 4096;
export const MAX_DELEGATIONS_PER_TURN = 3;

// Checkpoint snapshot caps (agent/checkpoints.ts). The per-file cap matches the
// tool read/write caps, so any tool-touched file fits.
export const CHECKPOINT_FILE_MAX = 512 * 1024;
export const CHECKPOINT_TOTAL_MAX = 2 * 1024 * 1024;

// Free-model discovery cache (providers/freeModels.ts).
export const DEFAULT_SYNC_TTL_MS = 10 * 60 * 1000; // 10 minutes

// Grep tool bounds (tools/grep.ts): pattern size and the longest line tested.
export const GREP_PATTERN_MAX_LENGTH = 256;
export const GREP_LINE_TEST_MAX = 4096;

// list_files walk bound (tools/listFiles.ts).
export const MAX_FILES = 10_000;

// write_file payload cap (tools/writeFile.ts).
export const MAX_WRITE_BYTES = 512 * 1024;

// verify_tests runner bounds (tools/verifyTests.ts).
export const RUN_TEST_TIMEOUT_MS = 60_000;
export const MAX_TEST_OUTPUT_BYTES = 30 * 1024;

// Project config file caps (config/rules.ts, config/memory.ts).
export const MAX_RULES_BYTES = 16 * 1024; // 16 KB cap
export const MAX_MEMORY_BYTES = 32 * 1024; // 32 KB cap

// Custom guardian rules bound (guardian/rules.ts): a runaway rules block must
// not make every scan quadratic.
export const MAX_CUSTOM_RULES = 32;

// Per-server default tool-call timeout for MCP config entries (config/mcp.ts).
// Distinct from DEFAULT_MCP_REQUEST_TIMEOUT_MS above, which is the transport
// default; this is the config-layer fallback before validation clamps it.
export const DEFAULT_MCP_TIMEOUT_MS = 60_000;
