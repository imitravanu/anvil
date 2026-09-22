# Phase 27 — Evaluation Harness 2.0 (Agent Evals Expansion) — Progress Record

> **Specification:** [`docs/PHASE-27-SPEC.md`](PHASE-27-SPEC.md)  
> **Status:** 27.1–27.6 IMPLEMENTED (2026-09-23) — acceptance criterion **E5**
> (artifact upload on a real workflow run) can only be observed in CI.  
> **Target Version:** Anvil v1.2.0  

---

## Task Checklist & Execution State

### 27.1 — Parallel Live Execution (Concurrency Pool)
- [x] Add `concurrency?: number` to `EvalRunnerOptions` in `packages/core/src/eval/types.ts`
- [x] Implement bounded Promise worker pool in `packages/core/src/eval/runner.ts`
- [x] Add `--concurrency <N>` flag parsing in `evals/run.ts`
- [x] Unit tests in `runner.test.ts` verifying concurrent execution order and error isolation
- *Done 2026-09-21: `mapWithConcurrencyLimit` (index-slot results stay in task
  order; shared counter hands indices synchronously) + `resolveConcurrency`
  (clamp [1, 8], default 1) fed by `EVAL_CONCURRENCY_DEFAULT/MAX` constants.
  `runAllEvalTasks` fans out; progress callbacks keep original indices;
  per-worker pacing preserves the 26.3 429 protection with no trailing wait.
  Flag `--concurrency <N>` + `ANVIL_EVAL_CONCURRENCY` env, banner line,
  bogus values exit 1. Tests: clamp table, order-under-disorder, worker bound,
  empty input, mixed pass/fail isolation at concurrency 3 (5 new, 11/11 file
  green). Smoke: `--mock --fast --concurrency 4` → 15/15. Live ≤2min at
  concurrency 4 not yet measured — Mercury's sequential lanes already run
  ~70s, so the target is expected to hold; will confirm on the next live run.*

### 27.2 — Multi-Language Benchmark Fixtures
- [x] `16-feature-ts-generics` (TypeScript generic event bus with a type check)
- [x] `17-bugfix-ts-narrowing` (TypeScript union narrowing fix)
- [x] `18-bugfix-py-off-by-one` (Python data processor with `python3 -m unittest` check)
- [x] `19-feature-py-lru-cache` (Python bounded decorator cache)
- [x] `20-refactor-py-dataclass` (Python dictionary to `@dataclass` migration)
- [x] Ensure all new fixtures include `assertions/expected/` for offline mock mode
- *Done 2026-09-23: all five fixtures added under `evals/tasks/`, each with
  `task.json`, `README.md`, idempotent `assertions/check.sh`, and offline
  `assertions/expected/` fixtures.*
- *Type-check without a toolchain dependency: the TS checks compile with the
  **workspace's own** `tsc`, resolved through `$0` (`$SCRIPT_DIR/../../../../`
  `node_modules/.bin/tsc`) rather than the sandbox cwd — a bare `npx tsc` in a
  temp dir would attempt a network install. Type-safety is additionally asserted
  at the type level: `16` carries a `@ts-expect-error` directive that becomes an
  unused-directive error if the emitter degrades to a permissive type.*
- *Every new fixture was verified in **both** directions: it passes in mock mode
  and its pristine `setup/` fails `check.sh` with the intended symptom (TS2339
  for `17`, `TypeError` for `21`, the specific assertion for the rest). A fixture
  that passes in its broken state would be a vacuous benchmark.*
- *Boundary note: `18`–`20` require `python3` (present on ubuntu-latest CI and on
  the dev machine). The check reports a clear message and exits 1 if it is
  missing, so a missing interpreter fails loudly instead of silently skipping.*
- *Guard added (NEW `eval/__tests__/fixtureIntegrity.test.ts`, 3 tests): the
  two-direction verification above is now mechanical. Gate Step 5 only proves a
  fixture goes GREEN with its reference fix; mock mode is green by construction,
  so a fixture that already passes on its pristine `setup/` would inflate the
  pass rate forever and nothing would notice. The guard re-runs every
  `assertions/check.sh` against a throwaway copy of that same `setup/` (mirroring
  `runEvalTask`'s sandbox env and 10s cap) and fails if any fixture exits 0. It
  also pins the suite size, the JSON shape `loadEvalTasks` needs, and a non-empty
  `assertions/expected/`. Verified by planting a deliberately vacuous probe task,
  which the guard rejected by name (`expected [ '99-vacuous-probe' ] to deeply
  equal []`) before the probe was removed.*

### 27.3 — Failure Diff Snapshots
- [x] Add `failureDiff?: string` to `EvalResult` in `packages/core/src/eval/types.ts`
- [x] Capture workspace diff before sandbox deletion in `runner.ts`
- [x] Persist `.diff` files in `saveEvalReport()`
- [x] Render diff summary for failed tasks in `report.ts`
- [x] Tests for diff capture and persistence (`eval/__tests__/failureDiff.test.ts`, 6)
- *Done 2026-09-23: NEW `eval/failureDiff.ts` (`captureFailureDiff`) — a
  file-tree comparison (no git dependency) of the pristine `setup/` against the
  post-run workspace, covering edits + creations + deletions, capped by
  `EVAL_FAILURE_DIFF_MAX_CHARS`. Captured in `runEvalTask`'s `finally` BEFORE
  the sandbox is removed, failure-only and best-effort. `saveEvalReport` writes
  `<run>/failures/<task-id>.diff`; `formatEvalReport` prints the first 10 lines
  for a failed task.*

### 27.4 — Multi-Turn Diagnostic Tasks
- [x] Design diagnostic tasks requiring a multi-turn iterative repair loop
- [x] Verify mock provider handles multi-turn sequence properly
- *Done 2026-09-23: five diagnostic tasks (`21`–`25`), each a broken project
  whose prompt is the spec's script — run the tests, diagnose across the
  codebase, fix the implementation, verify. They differ in defect class:
  circular-require initialization order, leaked internal array (aliasing),
  concurrent-vs-sequential async scheduling, a base-10 parser mangling decimal
  and hex literals, and a cross-module producer/consumer contract mismatch.*
- *`25` pins **both** sides of the contract in `test.js` (the producer's return
  shape and the consumer's output), so a one-file patch cannot satisfy it.*
- *Mock mode is unaffected by design: the mock provider emits `write_file` calls
  for `assertions/expected/` and ends the turn, so multi-turn structure is a
  live-mode property (the harness does not need a new code path). `23` was
  rewritten mid-implementation — its first version returned an aliased array
  that microtasks filled before the assertion, so it passed in its broken state
  (vacuous); it now asserts handler interleaving, which fails deterministically.*

### 27.5 — Real-Time Dollar Cost Estimation
- [x] Add token pricing fields to model definitions (`providers/types.ts`)
- [x] Add `estimatedCostUsd?: number` to `EvalReport` and `EvalResult`
- [x] Format cost display in `formatEvalReport()` (total line + per-task column)
- [x] Unit test for cost calculation logic (`eval/__tests__/cost.test.ts`, 14)
- *Done 2026-09-23: `eval/cost.ts` (`pricingForModel` / `estimateCostUsd` /
  `formatCost`); `createEvalReport` prices each task and aggregates.
  **Honest pricing policy (deliberate):** these model ids are forward-looking, so
  real prices cannot be verified from here — an invented price would be a silent
  lie in a spend report. `isFree` models are priced at exactly $0; every model
  without recorded `costPer1k*` pricing is reported **unknown**, never $0, and a
  run with any unknown task reports `n/a (N unpriced)` rather than a partial sum.
  Maintainers record real prices by adding `costPer1kInputTokens` /
  `costPer1kOutputTokens` to a registry row.

### 27.6 — CI Live Eval Hardening
- [x] Set `ANVIL_HOME: ${{ github.workspace }}/.anvil` in `.github/workflows/live-eval.yml`
- [x] Recompute SHA-256 and update `scripts/gate-manifest.json`
- *Done 2026-09-23: `actions/upload-artifact` does not expand `~`, so
  `path: ~/.anvil/evals/` uploaded a literal `~` directory — an empty artifact
  with a path warning. The job now pins `ANVIL_HOME` to
  `${{ github.workspace }}/.anvil` (the documented relocation env var, read by
  `resolveEvalsDir()`), and the upload path is the workspace-relative
  `.anvil/evals/`. The step label was also corrected to "all 25 tasks".*
- *PROTECTED ARTIFACT (§3.4): `.github/workflows/live-eval.yml` is protected, so
  this change (a) is declared here, (b) regenerated
  `scripts/gate-manifest.json` in the same working set, and (c) has a recorded
  protected-diff review in `PROGRESS.md` awaiting explicit human sign-off.*

---

## Reality & Gate Verification Log

| Date | Step | Status | Evidence / Notes |
| :--- | :---: | :---: | :--- |
| 2026-09-19 | Phase Inception | Ready | Spec and progress tracker drafted; Phase 26 protected from changes. |
| 2026-09-23 | 27.2 / 27.4 fixtures | PASS | Fixture suite 15 → 25 (5 TS/Python + 5 diagnostics), all green in `--fast --mock` (25/25, 3.3s). Each fixture additionally confirmed to FAIL on its pristine `setup/`. |
| 2026-09-23 | 27.2 fixture-integrity guard | PASS | NEW `eval/__tests__/fixtureIntegrity.test.ts` (3 tests, ~3.5s) fails any fixture that passes on its untouched `setup/`; proven by a planted vacuous probe. |
| 2026-09-23 | 27.6 CI hardening | PASS (local) | `ANVIL_HOME` + workspace-relative artifact path; manifest hash regenerated. The CI job itself can only be observed on a real workflow run (acceptance criterion E5). |
