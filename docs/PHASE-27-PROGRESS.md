# Phase 27 — Evaluation Harness 2.0 (Agent Evals Expansion) — Progress Record

> **Specification:** [`docs/PHASE-27-SPEC.md`](PHASE-27-SPEC.md)  
> **Status:** READY FOR EXECUTION (2026-09-19)  
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
- [ ] `16-feature-ts-generics` (TypeScript generic event bus with `tsc --noEmit` check)
- [ ] `17-bugfix-ts-narrowing` (TypeScript union narrowing fix)
- [ ] `18-bugfix-py-off-by-one` (Python data processor with `python3 -m unittest` check)
- [ ] `19-feature-py-lru-cache` (Python bounded decorator cache)
- [ ] `20-refactor-py-dataclass` (Python dictionary to `@dataclass` migration)
- [ ] Ensure all new fixtures include `assertions/expected/` for offline mock mode

### 27.3 — Failure Diff Snapshots
- [ ] Add `failureDiff?: string` to `EvalResult` in `packages/core/src/eval/types.ts`
- [ ] Capture workspace diff before sandbox deletion in `runner.ts`
- [ ] Persist `.diff` files in `saveEvalReport()`
- [ ] Render diff summary for failed tasks in `report.ts`
- [ ] Tests for diff capture and persistence

### 27.4 — Multi-Turn Diagnostic Tasks
- [ ] Design diagnostic tasks requiring `verify_tests` and multi-turn iterative repair
- [ ] Verify mock provider handles multi-turn sequence properly

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
- [ ] Set `ANVIL_HOME: ${{ github.workspace }}/.anvil` in `.github/workflows/live-eval.yml`
- [ ] Recompute SHA-256 and update `scripts/gate-manifest.json`

---

## Reality & Gate Verification Log

| Date | Step | Status | Evidence / Notes |
| :--- | :---: | :---: | :--- |
| 2026-09-19 | Phase Inception | Ready | Spec and progress tracker drafted; Phase 26 protected from changes. |
