# Phase 27 — Evaluation Harness 2.0 (Agent Evals Expansion) — Progress Record

> **Specification:** [`docs/PHASE-27-SPEC.md`](PHASE-27-SPEC.md)  
> **Status:** READY FOR EXECUTION (2026-09-19)  
> **Target Version:** Anvil v1.2.0  

---

## Task Checklist & Execution State

### 27.1 — Parallel Live Execution (Concurrency Pool)
- [ ] Add `concurrency?: number` to `EvalRunnerOptions` in `packages/core/src/eval/types.ts`
- [ ] Implement bounded Promise worker pool in `packages/core/src/eval/runner.ts`
- [ ] Add `--concurrency <N>` flag parsing in `evals/run.ts`
- [ ] Unit tests in `runner.test.ts` verifying concurrent execution order and error isolation

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
- [ ] Add token pricing constants to model registry (`registry.ts`)
- [ ] Add `estimatedCostUsd?: number` to `EvalReport` and `EvalResult`
- [ ] Format cost display in `formatEvalReport()`
- [ ] Unit test for cost calculation logic

### 27.6 — CI Live Eval Hardening
- [ ] Set `ANVIL_HOME: ${{ github.workspace }}/.anvil` in `.github/workflows/live-eval.yml`
- [ ] Recompute SHA-256 and update `scripts/gate-manifest.json`

---

## Reality & Gate Verification Log

| Date | Step | Status | Evidence / Notes |
| :--- | :---: | :---: | :--- |
| 2026-09-19 | Phase Inception | Ready | Spec and progress tracker drafted; Phase 26 protected from changes. |
