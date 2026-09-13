# Phase 23: Stability & Performance (v0.10.0) Progress Report

> **Date:** 2026-09-13  
> **Status:** COMPLETED  
> **Version:** 0.9.1 → 0.10.0  
> **Branch:** master  
> **Chief Engineer:** Antigravity  

---

## 1. Executive Summary

Phase 23 eliminates silent failures, algorithmic bottlenecks, and UI render chokepoints across the Anvil core and TUI packages. Per the scope ruling established in [`docs/PHASE-21-25-AUDIT.md`](PHASE-21-25-AUDIT.md), the stability and performance scope comprises items **23.1–23.7** and **23.8** (the 60 FPS stream delta backpressure buffer). Terminal-platform extensions (items 23.9–23.15: alternate screen buffer, OSC-52 clipboard, mouse protocols, etc.) are deferred to a dedicated terminal platform milestone.

All stability and performance deliverables have been implemented, tested, and verified under Guardian Gate Step 0 through Step 7.

---

## 2. Implementation Details

### 23.1 — Elimination of Silent `catch {}` Blocks
- **Files:** `packages/core/src/config/index.ts`, `packages/core/src/tools/bash.ts`, `packages/core/src/agent/checkpoints.ts`, `packages/core/src/agent/goal/awareness.ts`, `packages/core/src/providers/cache.ts`, `packages/core/src/agent/session.ts`, `packages/core/src/agent/orchestrator.ts`
- **Fix:** Swapped bare empty catch blocks with structured warning logs (`console.warn`) using `getErrorMessage(err)` or added explicit code comments explaining intentional swallows (e.g. expected ESRCH on process termination race or first-run uninitialized config).
- **Rule:** `grep -rn 'catch\s*{' packages/*/src/` returns zero uncommented instances.

### 23.2 — Amortized O(1) Ledger Recording
- **File:** `packages/core/src/agent/session.ts`
- **Problem:** `recordLedger()` was cloning the entire ledger array on every single tool and event recording: `this.ledger = capLedger([...this.ledger, entry])`. For long sessions with hundreds of actions, this generated O(n²) memory allocations.
- **Fix:** Switched to in-place `.push(entry)` with amortized pruning via `if (this.ledger.length > LEDGER_CAP) this.ledger = capLedger(this.ledger)`.
- **Verification:** Covered by tests in `packages/core/src/agent/__tests__/phase23.test.ts`.

### 23.3 — History Compaction Cut Optimization
- **File:** `packages/core/src/agent/compaction.ts`
- **Problem:** `findCleanCompactionCut()` iterated over all candidates and for each performed `intervals.some(i => i.isSplit(cut))`, creating an O(n²) search across turn intervals.
- **Fix:** Pre-computed a lookup `splitCuts = new Set<number>()` mapping all split indices across intervals before evaluating cuts, reducing candidate checks to O(1) set lookups.
- **Verification:** Covered by tests in `packages/core/src/agent/__tests__/phase23.test.ts`.

### 23.4 — Hot-Path TUI Component Memoization
- **File:** `packages/tui/src/components/MessageView.tsx`
- **Problem:** Every incoming streaming delta re-rendered every past message in the transcript, consuming layout cycles in Yoga/Ink.
- **Fix:** Wrapped `MessageView` export in `React.memo` to skip re-rendering messages whose props (`message`, `theme`, `maxWidth`, `activeToolId`) remain unchanged.

### 23.5 — Word-Diff LCS Bailout Threshold Tuning
- **File:** `packages/tui/src/diff/wordDiff.ts`
- **Problem:** Word-level LCS computation had an upper threshold of 50,000 matrix operations before bailing out, which caused noticeable latency spikes on large block replacements.
- **Fix:** Lowered the LCS bailout limit to 10,000 operations (`MAX_LCS_OPERATIONS = 10_000`). Bailed-out spans cleanly fall back to marking all deleted tokens red and inserted tokens green without hanging the main event loop.
- **Verification:** Verified by tests in `packages/tui/src/diff/__tests__/richDiff.test.ts`.

### 23.6 — CI Visual Regression Pipeline Verification
- **Files:** `.github/workflows/visual-regression.yml`, `packages/tui/scripts/visual-diff.mjs`
- **Verification:** Verified that visual captures write to `__visual-current__/` and pixel-diffs are evaluated against committed `__visual-baselines__/` with a 0.1% pixel threshold via `pixelmatch`.

### 23.7 — Release Workflow Partial Publish Guard
- **File:** `.github/workflows/release.yml`
- **Design:** Package bundling and verification occur prior to npm distribution steps, preventing partially published states if one workspace fails.

### 23.8 — Stream Delta Backpressure Buffer (60 FPS Token Throttle)
- **File:** `packages/tui/src/hooks/useAgentController.ts`
- **Problem:** Fast streaming models (Groq, Cerebras, Gemini Flash) yielding 100–200 tokens/sec triggered 200 state updates and 200 full Ink/Yoga layout passes per second, starving the event loop and dropping user keystrokes (such as Esc or Ctrl+C).
- **Fix:** Implemented a batched backpressure buffer in `useAgentController.ts`:
  - Incoming `text_delta` chunks accumulate in a local buffer.
  - State updates are throttled to ~60 FPS via a 16ms timer (`setTimeout(..., 16)`).
  - Any non-text event (`tool_started`, `tool_finished`, `tool_permission_denied`, `error`, `cancelled`, turn end) immediately flushes the pending text buffer to preserve ordering and complete fidelity.
  - Flush timers are safely cleared on component unmount and turn settlement.
- **Verification:** Tested by unit test suite in `packages/tui/src/hooks/__tests__/useAgentController.test.tsx`.

---

## 3. Verification & Certification Summary

| Stage | Command | Result |
|---|---|---|
| Monorepo Build | `npm run build` | Pass (All 3 packages: core, tui, cli) |
| Strict Typecheck | `npm run typecheck` | Pass (0 errors across monorepo) |
| Core & TUI Unit Tests | `npm test` | Pass (584/584 tests passing) |
| Mock Eval Benchmarks | `npm run eval -- --fast --mock` | Pass (15/15 tasks passing, 100%) |
| Visual Regression Baselines | `npm run visual -w @anvil/tui` | Pass (Updated to v0.10.0) |
| Guardian Gate Sentinel | `npx vitest run packages/cli/src/__tests__/gate.sentinel.test.ts` | Pass (11/11 tests passing) |
| Guardian Gate Full Run | `node scripts/verify-gate.mjs --ack-protected-change` | PASS (All steps satisfied) |
