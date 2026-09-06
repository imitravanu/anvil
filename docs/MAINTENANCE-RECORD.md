# Maintenance Record - 2026-09-06

## Changes Made

### 1. Checkpoint Persistence Race Fix (High Priority)
**Files:** `packages/core/src/agent/session.ts`, `packages/core/src/agent/checkpointStore.ts`

**Problem:** `persistCheckpoints()` was fire-and-forget, meaning if the process crashed after
in-memory state was updated but before the file write completed, checkpoint data could be lost.

**Fix:**
- Added `saveCheckpointsAsync()` using `fs/promises` for proper async file operations
- Made `persistCheckpoints()` async and awaited it at all call sites:
  - `mergeSubCheckpoints()` - now async, awaits persist
  - `send()` checkpoint creation - now awaits persist
- Both `mergeSubCheckpoints()` call sites in `send()` now await the operation

**Impact:** Checkpoint persistence is now reliable and won't lose data on crash.

---

### 2. O(1) Model Registry Lookup (Medium Priority)
**File:** `packages/core/src/providers/registry.ts`

**Problem:** `MODEL_REGISTRY.find()` is O(n) linear search for every model lookup.

**Fix:**
- Added `_modelIndex` Map for O(1) lookup by model ID
- Added `getModel(id)` function using the index
- Updated `registerModel()` to maintain index
- Updated `unregisterModels()` to clean up index
- Called `_reindex()` at module load to initialize index

**Impact:** Faster model lookups, especially with large model registries.

---

### 3. Exponential Backoff for Rate Limits (Medium Priority)
**File:** `packages/core/src/providers/freeModels.ts`

**Problem:** No exponential backoff for consecutive rate limit failures.

**Fix:**
- Added `consecutiveRateLimits` Map to track consecutive failure counts per provider/model
- Added `getConsecutiveRateLimitCount()` function
- Updated `rateLimitRetrySeconds()` to accept consecutive failure count
- Applied exponential backoff formula: `wait * (2 ^ (consecutive - 1))`, capped at MAX_RETRY_WAIT_S
- Added `clearRateLimitRecord()` to reset state on success

**Impact:** More robust handling of rate-limited providers with automatic backoff.

---

### 4. Circuit Breaker for Rate-Limited Providers (Medium Priority)
**File:** `packages/core/src/providers/freeModels.ts`

**Problem:** No circuit breaker to fail fast when a provider is experiencing repeated failures.

**Fix:**
- Added `CircuitBreakerEntry` interface with state, failureCount, lastFailureAt, halfOpenAt
- Added `circuitBreakers` Map keyed by `sourceId:modelId`
- Circuit opens after 5 consecutive failures (CIRCUIT_BREAKER_THRESHOLD)
- When open, requests fail immediately with error message
- Circuit half-opens after 60 seconds (CIRCUIT_BREAKER_TIMEOUT_MS) to test recovery
- Added functions: `isCircuitOpen()`, `getCircuitState()`, `recordSuccess()`, `recordFailure()`
- Updated session.ts to check circuit breaker before streaming requests
- Added `recordSuccess()` calls on successful turn completion
- Added `recordFailure()` calls on stream errors

**Impact:** Prevents hammering failing providers and provides faster failure feedback.

---

### 5. SIGWINCH Handler (Already Implemented)
**File:** `packages/tui/src/components/App.tsx`

**Note:** This was already correctly implemented in the TUI component.
The App component already has a resize handler using `stdout.on("resize", resizeTick)`
that triggers re-renders on terminal resize.

---

### 6. MCP Tool Collision Warning (Already Implemented)
**File:** `packages/cli/src/index.tsx`

**Note:** This was already correctly implemented.
Line 192 generates warnings for dropped MCP tools:
```typescript
for (const d of collision.dropped) mcpNotices.push(`MCP dropped tool ${d.name} (name collision)`);
```

---

## Test Results

```
@anvil/core: 43 test files, 266 tests PASSED
@anvil/tui:  23 test files, 108 tests PASSED
@anvil/cli:  2 test files,  8 tests PASSED
Total:       68 test files, 382 tests PASSED (0 failures)
Build: SUCCESS
Typecheck: SUCCESS
```

---

## Strategic Phases Completed (2026-09-06)

### Phase 11: Codebase Intelligence v1
- Implemented `get_outline` structural symbol extractor across 6 languages.
- Implemented `.anvil/rules`, `AGENTS.md`, and `.cursorrules` automated discovery engine.
- Specs: `docs/PHASE-11-SPEC.md`, `docs/PHASE-11-PROGRESS.md`.

### Phase 12: Headless & Unix Pipeline Runner
- Implemented `runHeadless` streaming stdout and diagnostic stderr engine.
- Added `-p / --prompt`, `-y / --yes`, `--raw`, and stdin piping.
- Specs: `docs/PHASE-12-SPEC.md`, `docs/PHASE-12-PROGRESS.md`.

### Phase 13: Closed-Loop TDD Auto-Verification & Self-Repair Engine
- Implemented `verify_tests` tool detecting npm, cargo, pytest, and go test runners.
- Integrated automated verification post-mutation in `session.ts` with 2-attempt self-repair loops.
- Specs: `docs/PHASE-13-SPEC.md`, `docs/PHASE-13-PROGRESS.md`.

### Phase 14: Autonomous Goal Engine & Situational Awareness
- Implemented `SituationalContext` and `analyzeWorkspace` introspecting git, package managers, scripts, and topology.
- Implemented `GoalEngine` decomposing goals into milestones, executing autonomously, running adversarial self-critique, and debriefing.
- Wired `anvil -g, --goal "<objective>"` headless runner and `/goal <objective>` TUI command.
- Specs: `docs/PHASE-14-SPEC.md`, `docs/PHASE-14-PROGRESS.md`.

### Phase 15: The Autonomous Agent Cockpit TUI
- Implemented Situational Cockpit Header rendering repo, branch/dirty, ecosystem, package manager, test runner, rules.
- Implemented telemetry status bar with real-time test suite health and checkpoint counter.
- Implemented observable VerificationCard with closed-loop TDD and auto-repair badges in the transcript.
- Implemented docked MissionDeck HUD tracking autonomous goals, milestone DAG states, and turn economy.
- Implemented interactive syntax-highlighted DiffModal with file tabs and RewindModal checkpoint timeline rollback.
- Specs: `docs/UI-ADVANCEMENT-AUDIT.md`, `docs/PHASE-15-SPEC.md`, `docs/PHASE-15-PROGRESS.md`.
