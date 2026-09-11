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

---

# Maintenance Record - 2026-09-10 (chief-engineer deep dive)

## Pre-existing tree state (not mine — other agents' uncommitted work)

The working tree was already dirty on arrival. These files were modified by
other agents and were **not touched** by this session:

- `packages/cli/src/headless.ts` (+7) — handles a new `verification_gave_up` event on stderr.
- `packages/core/src/agent/checkpoints.ts` (+20) — new `summarizeSessionChangesFromBaseline()` + extracted `diffBaseline()`; session keeps a first-seen baseline across all snapshots so `/diff` survives ring eviction.
- `packages/core/src/agent/goal/goalEngine.ts` (+12) — `verification_gave_up` marks the milestone outcome failed with deck detail.
- `packages/core/src/agent/session.ts` (+64/−33, 8 hunks) — supports the above (baseline map, new event emission).
- `packages/tui/src/hooks/useAgentController.ts` (+26) — `verification_gave_up` renders a system notice, pins the verification card failed, sets test status failed.

No conflicts with the changes below (disjoint files/regions). Coordinating note:
`session.ts` is shared ground — the `verification_gave_up` feature owns it right now.

## Changes made (this session)

### 1. Permission-prompt abort handling (High Priority)
**Files:** `packages/tui/src/permission/TuiPermissionBroker.ts`,
`packages/core/src/agent/types.ts`, `packages/core/src/agent/orchestrator.ts`

**Problem:** `ToolOrchestrator` races the broker against the turn's abort
signal, but a fired abort only resolved the orchestrator's wrapper promise —
the broker's queued promises stayed pending forever (stuck overlay state,
leaked promises on Ctrl+C during a prompt).

**Fix:**
- `PermissionBroker` gains optional `attachAbortSignal?(signal)` (backward compatible).
- `TuiPermissionBroker.attachAbortSignal()` rejects current + queued requests with `false` on abort; per-signal listener map (re-attachable each turn, idempotent per signal, immediate-reject if already aborted).
- Fixed an orphan bug found mid-implementation: `rejectAllPending()` drained `current` first, which let `pump()` promote a queued item into `current` and strand its promise — queue is now spliced **before** resolving `current`.
- `ToolOrchestrator.run()` calls `permissionBroker.attachAbortSignal?.(signal)` at batch start.

### 2. `BaseProvider` abstract class (Medium Priority — tech-debt removal)
**Files:** `packages/core/src/providers/base.ts` (new),
`anthropic.ts`, `openai.ts`, `gemini.ts`, `index.ts`

**Problem:** all 9 adapters reimplemented the same `streamCompletion`
try/catch + not-configured guard.

**Fix:** `BaseProvider` owns `streamCompletion` (configured check → `doStream` → `ensureTurnEnd` → error containment); subclasses implement only `doStream` (sync generator or async, via union return type — `await`ed in base).
Migrated: `AnthropicProvider`, `ChatCompletionsStyleProvider` (covers
OpenAI + OpenRouter + Orcarouter + Groq + Cerebras + GitHub + Mistral + Ollama
via the shared factory), `GeminiProvider`. Exported from `providers/index.ts`.

### 3. `eval/mockProvider.ts` syntax fix (build breaker)
**File:** `packages/core/src/eval/mockProvider.ts`

**Problem:** mis-indented `yield` block broke `tsc` for the whole core package.

**Fix:** re-indented the tool-call emission block; no behavior change.

### 4. Regression tests (+6)
- `packages/tui/src/permission/__tests__/broker.test.ts` (+3): abort rejects head **and** queue (no orphans), already-aborted signal rejects immediately, per-turn re-attach works.
- `packages/core/src/providers/__tests__/base.test.ts` (new, +3): unconfigured short-circuit, `doStream` delegation with guaranteed `turn_end`, throw → error event.

## Test results

```
typecheck: @anvil/core OK, @anvil/tui OK, @anvil/cli OK
@anvil/cli:  2 files,   8 tests PASSED
@anvil/core: 49 files, 344 tests PASSED (341 existing + 3 new)
@anvil/tui:  27 files, 152 tests PASSED (149 existing + 3 new)
visual:diff: 96/96 scenarios PASS (0% diff) — Phase 0 gate green
```

## Phase 0 assessment (correction)

The 2026-09-08 spec (`docs/PHASE-0-VISUAL-REGRESSION-SPEC.md`) is marked
DRAFT, but the infrastructure **already exists and passes** (built by another
agent): `visual-capture.mjs` / `visual-diff.mjs` / `visual-approve.mjs`,
text-frame baselines (8 scenarios × 6 sizes × 2 themes = 96, `.txt` frames
instead of the spec's PNG plan — cheaper and sufficient),
`.github/workflows/visual-regression.yml`, `__visual-current__/report.json`.
`npm run visual:diff` run this session: **SUCCESS, all 96 match within 0.1%**.
Remaining Phase 0 gap is documentary only: flip the spec status DRAFT → DONE.

## Addendum — 2026-09-10, full 4-workstream audit + self-fix

A TUI-audit workstream caught a leak introduced by §1 above: `attachAbortSignal`
per orchestrator batch with no detach (one listener + map entry per tool batch,
forever). Fixed: `PermissionBroker` gains optional `detachAbortSignal?`, called
in `ToolOrchestrator.run()` `finally`; removed the now-unused `ensureTurnEnd`
import in `anthropic.ts`. Verified: typecheck clean (3 packages), full suite
green (cli 8 / core 344 / tui 152). Full audit reports (core, TUI/CLI, docs-vs-code,
QA infra) were delivered to the chief engineer and condensed into the completion
roadmap; headline corrections: Phases 0/17/19 are functionally complete, 18 is
mock-complete with live proof missing, 20 is scaffolding-complete with no
clean-machine proof, README carries ~13 stale claims (9→10 providers, 10→11 tools,
36→49 models), and the only open UX item is U11 (MCP prompt UX).

## Addendum 2 — 2026-09-10, Wave 1 safety fixes (5 of 7)

Executed the roadmap's Wave 1, skipping the two items inside `session.ts`
(safety-refusal surfacing, pre-permission snapshot pollution) — that file is
owned by the concurrent `verification_gave_up` feature until committed.

### W1-1. Scoped auto-commit staging (secret-leak fix)
**Files:** `packages/core/src/git/gitUtils.ts`,
`packages/core/src/agent/goal/goalEngine.ts` (one hunk, disjoint from the
other agent's), `goal/__tests__/goalEngine.test.ts`, `git/__tests__/gitUtils.test.ts` (new)
- `autoCommitMilestone(root, id, title, paths?)` stages ONLY the given paths
(`git add -- <paths>`); empty/missing paths refuse the commit (fail closed) —
the old `git add -A` swept untracked `.env`/keys into history.
- `runGoalMission` passes the `/diff` baseline (`deps.summarizeChanges()`) and
yields an honest "Skipped auto-commit: no session-touched files" notice.
- `getBranchDiff` appends `--` (branch-`-` flag-injection hardening).
- Rewrote the auto-commit mission test to drive a REAL `write_file` turn with
an untracked secret present: asserts the commit contains exactly
`feature.txt` and the secret stays untracked; added a no-touch skip test.
- New `gitUtils.test.ts` (5 tests): scoped staging, fail-closed, clean tree,
branch diff, unknown-branch error.

### W1-2. Permission-prompt highlight reset
**Files:** `packages/tui/src/components/PermissionPrompt.tsx`,
`components/__tests__/permission.test.tsx`, `test-utils/testRender.tsx`
- `useEffect(() => setSelected(0), [request])`: a queued request reusing the
overlay can no longer inherit the previous request's highlight (fast-Enter
could Allow a dangerous tool or Deny a benign one).
- Exposed `rerender` in the themed test harness; added a regression test that
moves to "Always allow", swaps requests, and proves Enter hits "Allow once".

### W1-3. Permission grants die with the session
**Files:** `TuiPermissionBroker.ts` (+`clearSessionApprovals()`),
`commands/registry.ts` (`/clear`, `/session new`),
`hooks/useSessionCommands.ts` (`resumeFromStored`),
`components/App.tsx` (cross-provider model switch with history clear)
- "Always allow" grants no longer leak across conversations; confirmations
say grants were reset. Added a broker unit test.

### W1-4. Empty tool-result push guard
**Files:** `packages/core/src/agent/historyStore.ts`,
`agent/__tests__/historyStore.test.ts` (new, 3 tests)
- `pushToolResults` returns early when there are no results and no notes — a
declared `tool_use` turn with zero `tool_call_end`s no longer inserts an
empty user message that corrupts provider replay.

### W1-5. Anthropic vision MIME passthrough
**Files:** `packages/core/src/providers/anthropic.ts` (+ test)
- Real `media_type` (png/jpeg/webp/gif — exactly the `/image` allowlist)
instead of hardcoded `image/png`; unknown values fall back to png. Added a
4-MIME round-trip test.

### Cross-agent note (type-only fix in another agent's file)
`packages/core/src/agent/__tests__/auditFixes.test.ts` (concurrent WIP by
another agent, edited live during this session) used `as const` scripts that
broke package-wide `tsc`. Fixed minimally (`ScriptEntry[]` annotations, repo
convention) — test LOGIC untouched. That file's 2 failing tests are the owning
agent's in-flight work, NOT regressions from this session:
- `verification_gave_up` count: their script undercounts provider calls
("FakeProvider: script exhausted" — repair-loop continuations consume extra
turns their 4-entry script doesn't provide).
- `/diff` baseline: one `send()` consumes 2 script entries (1 file), but the
test scripts 6 files behind a single send — only `file1.js` is written.
Left for the owning agent; they are actively debugging it (DEBUG logs in tree).

### Verification
```
typecheck: clean (core, tui, cli)
tests: cli 8 passed; tui 154 passed; core 355 passed + 2 failed (both =
  the other agent's WIP auditFixes.test.ts described above; all 8 new +
  2 rewritten tests from this session pass)
```

## Addendum 3 — 2026-09-10, roadmap Waves 2–4 execution

### Wave 2 — reliability (all done except session.ts-owned items)
- **ModelPicker empty-filter NaN** (`ModelPicker.tsx`): nav/confirm short-circuit on
empty `ordered`; header shows a helpful empty state instead of `NaN/0`.
- **Provider-switch stale transcript** (`App.tsx`): `clearMessages()` on
history-clearing switches — transcript never shows turns the session lost.
- **SessionPicker sync disk read in render** (`SessionPicker.tsx`): loads once via
state initializer with try/catch + error row instead of crashing the frame.
- **verifyTests env passthrough** (`verifyTests.ts` + 4 tests): opt-in
`ANVIL_TEST_ENV_ALLOW="DATABASE_URL,NODE_ENV,..."` (validated names); unlisted
vars still scrubbed (tested both directions).
- **Registry pricing honesty** (`registry.ts`): all 11 unflagged paid rows
(5 Anthropic, 4 OpenAI, 2 Gemini pro) marked `isFree: false` — paid models no
longer render as free; picker (free-only by design) hides them consistently;
`resolveProviderSelection` defaults unaffected (full-registry lookup).
- **`getModel` cross-provider fallback removed**: qualified miss returns
`undefined` (callers already null-handle); fixes wrong-contextWindow
compaction + wrong-row certification mutation. `orcarouter.test.ts` count pin
made dynamic.
- **freeModels registration scoped by provider**: same id on two providers no
longer suppresses the second row.
- **MCP reconnect keeps the working connection** (`mcp/client.ts`): replacement
connects first; old transport closes only on success, new transport closes on
failure.
- **Concurrent-batch abort checks** (`orchestrator.ts`): pre- and post-`Promise.all`
aborted paths record `cancelled` and emit no post-abort `tool_finished`.
- **Eval timeout actually wired** (`eval/runner.ts`): timeout now calls
`session.cancel()` (previously aborted a dead controller while hung providers
stalled `for await` forever).
- **Goal SIGINT parity + raw contract** (`goalRunner.ts`): first Ctrl+C cancels
gracefully (listener removed in `finally`), second exits 130; `goal_failed`
and engine-catch stderr gated behind `--raw`.

### Wave 3 — gates that gate (done)
- **Direct `ToolOrchestrator` unit tests** (new, 8 tests): serial/concurrent
policy, unknown-as-mutating, deny path, pre/post abort, attach/detach
bookkeeping, broken-broker deny-by-default.
- **Compat-adapter delegation tests** (new, 10 tests): groq/cerebras/github/
mistral/ollama id/displayName/configured flags, unconfigured-error event,
shared-translator tool-call assembly end to end.
- **Sub-agent checkpoint litter fixed** (`subagent.ts`): after draining the ring
to the parent, the sub-session's persisted file is deleted
(`saveCheckpointsAsync(sub.id, [])`, best-effort) + regression test asserting
an empty checkpoints dir post-delegation.
- **Live eval lane** (`.github/workflows/live-eval.yml`, new): weekly schedule +
manual dispatch, opt-in via `ANVIL_EVAL_LIVE_ENABLED` secret, full non-mock
eval + live cert matrix with report/matrix artifacts. Mock PR gate untouched.
- **Cert matrix persistence** (`scripts/certify-provider.ts --out`): stamped
`{certifiedAt, mode, totalPassed, totalTested, results}` JSON; verified
`--mock --all --out` writes 10/10 matrix.

### Wave 4 — truth + finish (done except noted deferrals)
- **README**: 10 providers (+Orcarouter), 11 tools (+update_memory), 49 models,
registry-exact model ids (Anthropic dashes, real OpenRouter/Orcarouter free
ids), `✅ live*` caveat for the 2 untested newest models + live-lane note,
fixed "How this was built" phantom filenames, added Phases 0/17–20 row.
- **Specs**: Phase 0 DRAFT→DONE; Phase 10 hot-reload supersession recorded.
- **Distribution proof**: `npm run build` + `npm pack --dry-run` for core
(150 files) and cli (6.3 MB bundle, 5 files) succeed — metadata-verified,
still not a published/clean-machine proof (unchanged claim level, now stated).
- **U11 prompt half closed** (`PermissionPrompt.tsx`): MCP tools show
`MCP <tool> (server: <server>)` + external-visibility caution; `mcpServerOf`
unit-tested incl. underscore edge cases. Server health was already in `/mcp`.

### Deferred with rationale (not forgotten)
- **W1-6/7 (safety-refusal surfacing, pre-permission snapshots)**: inside
`session.ts`, owned by the concurrent `verification_gave_up` feature — its
author is live in that exact region (their 2 `auditFixes` tests went from red
to green during this session; their DEBUG logs are still in-tree).
- **H3 transcript system-message cap + H4 memoization**: the fix lives in
`useAgentController.applyEvent`, where the same agent added hunks mid-session.
Slow leak, bounded blast radius — revisit once their feature lands.

### Verification (final)
```
typecheck: 0 errors (core, tui, cli)
tests: cli 8 + core 382 + tui 156 = 546 passed, 0 failed
  (new this session: gitUtils 5, orchestrator 8, compatAdapters 10,
   historyStore 3, subagent 1, verifyTests 4, anthropic +1, broker +4,
   permission +3, goalEngine +1 net — plus the other agent's auditFixes 3)
visual:diff: 96/96 PASS (0% diff) after the UI changes
certify --mock --all --out: 10/10 matrix written
```

## Addendum 4 — 2026-09-10, final code items (W1-6, W1-7, H3)

The concurrent `verification_gave_up` feature settled (its tests green, DEBUG
logs removed), so the three deferred items were implemented against the
stabilized tree. Touches inside the other agent's regions are mechanical and
semantically neutral to their feature (verified: their 3 tests still pass).

### W1-6. Safety-refusal turns error instead of completing
**File:** `packages/core/src/agent/session.ts` (+ test in `session.test.ts`)
- A `turn_end` with `stopReason === "error"` (Gemini content/safety blocks)
now yields `{type:"error"}` instead of gliding through verify into
`recordSuccess` + `turn_complete` (which also told the goal engine a filtered
turn was clean work). Verification still runs first for earlier mutations in
the turn; no circuit-breaker accounting (a content filter is not an outage).
- Test: filtered turn yields the declined-message error and never `turn_complete`.

### W1-7. Checkpoints persist only when a covered call mutated
**File:** `packages/core/src/agent/session.ts` (+ `rewind.test.ts` R5)
- Snapshot bytes are still captured pre-permission (required), and the review
baseline still records first-seen originals (first-seen-wins, harmless for
denied calls) — but the ring/event/ledger/persist now happen post-batch and
only if a `write_file`/`edit_file` call has a non-error outcome. Denied or
errored batches: silent drop, no eviction churn. Observable change: the
`checkpoint` event now follows tool completion instead of preceding it
(order-insensitive consumers unaffected — verified R1–R4 still pass).
- Test R5: denied write → no event, empty ring, no `checkpoint_created` row,
file untouched.

### H3. Transcript system-message bound
**File:** `packages/tui/src/hooks/useAgentController.ts` (+ hook test)
- New `appendSystemMessage` helper applies `TRANSCRIPT_STATE_CAP` to all 8
system-notice sites (compacted, rate-limit, budget, loop, plan, gave_up,
checkpoint, printSystemMessage). The other agent's `verification_gave_up`
case was converted text-identically.
- Test: CAP+50 notices → length bounded, newest survive.

### Verification (final)
```
typecheck: 0 errors (core, tui, cli)
tests: cli 8 + core 384 + tui 157 = 549 passed, 0 failed
visual:diff: 96/96 PASS (0% diff)
```

### Project-complete statement
Every roadmap item executable without external credentials is now done:
Waves 0–4 code, mock CI gates, weekly live lane (armed via secrets), cert
matrix persistence, README/spec truth, U11 prompt half, distribution dry-run
proofs. Remaining non-code items for the maintainer: commit per feature,
`npm publish` + clean-machine install (needs credentials), arming
`ANVIL_EVAL_LIVE_ENABLED`, and the other agent's `verification_gave_up` spec
note (their feature, their record).

## Still open (not started — recommendations)

1. `AgentSession` (825 lines) and `useAgentController` (746+ lines) remain god-class refactors — split into services/hooks when the `verification_gave_up` feature lands and `session.ts` is free.
2. `goalEngine.ts` `parseMilestones` regex-JSON extraction is fragile — replace with schema-validated parsing.
3. `isReadOnlyCommand` + `isBlockedCommand` interplay deserves a dedicated adversarial test file (chained-command cases); no change made — current metachar guard already rejects `&&`/`;`/`|` chains.
