/**
 * Centralized core operational constants.
 * Enforces Constitution Rule: NO Hardcoded Magic Constants.
 */

// Tool Execution Limits
export const MAX_READ_FILE_BYTES = 512 * 1024; // 512 KB
export const RUN_COMMAND_TIMEOUT_MS = 120_000; // 2 minutes default command timeout
export const MIN_COMMAND_TIMEOUT_MS = 1_000; // 1 second lower bound
export const MAX_COMMAND_TIMEOUT_MS = 600_000; // 10 minutes upper bound
export const MAX_STREAM_BYTES = 20 * 1024; // 20 KB captured output per stream

// Context Window & Compaction Thresholds
export const COMPACTION_TOKEN_THRESHOLD = 80_000;
export const DEFAULT_MAX_TOKENS = 4096;

// Rate Limiting & Retry Policy
export const RATE_LIMIT_MAX_RETRIES = 3;
export const RATE_LIMIT_INITIAL_DELAY_MS = 1000;
export const RATE_LIMIT_MAX_DELAY_MS = 30_000;

// Subagent & Orchestration Depth Limits
export const MAX_SUBAGENT_DEPTH = 3;
export const MAX_CONCURRENT_SUBAGENTS = 5;

// Session Review Baseline Bounds (caps the ring-independent /diff baseline
// so a long session touching many files cannot grow memory without bound;
// eviction drops the oldest-seen path first and /diff degrades gracefully)
export const BASELINE_MAX_PATHS = 200;
export const BASELINE_MAX_BYTES = 8 * 1024 * 1024; // 8 MB total snapshot bytes

// Guardian Gate Verification Defaults
export const DEFAULT_GATE_TIMEOUT_MS = 180_000; // 3 minutes timeout per gate step

// TUI / UI / UX Performance & Responsiveness Constraints
export const TUI_FRAME_RATE_HZ = 60;
export const TUI_STREAM_THROTTLE_MS = 16; // ~60 FPS token stream buffer
export const MIN_TERMINAL_COLUMNS = 60; // Minimum responsive column budget
