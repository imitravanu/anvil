# Phase 27 — Evaluation Harness 2.0 (Agent Evals Expansion) — SPEC

> **Priority:** HIGH (Agent Intelligence & Verification Benchmarking)  
> **Status:** PROPOSED & SPECIFIED (2026-09-19)  
> **Target:** Anvil v1.2.0  
> **Pre-requisite:** Phase 17 (v0.8.0 Baseline Eval Harness)  

---

## 1. Objectives & Motivation

Anvil's initial evaluation harness (Phase 17) provided a deterministic 15-task mock and live benchmark suite in `evals/tasks/` and `packages/core/src/eval/`.

While effective as an offline CI gate, the Phase 17 implementation has five operational bottlenecks:
1. **Sequential Live Runs**: Running 15 tasks sequentially against live LLM providers takes 6–8 minutes.
2. **Language Mono-culture**: All 15 existing tasks are CommonJS JavaScript. Anvil is a multi-language agent, but its eval suite currently tests only Node.js.
3. **No Failure Diffs**: When a model fails a task, only `exit code 1` and raw test stderr are saved; the actual code edits produced by the model are discarded.
4. **Single-Turn Bias**: Fixture tasks are solvable in 1 turn (prompt → write_file). They do not evaluate multi-turn diagnostic loops (`verify_tests` → diagnose → edit → re-verify).
5. **No Financial Cost Visibility**: Token usage is measured, but no dollar ($) cost is calculated.

Phase 27 modernizes the evaluation harness to address these bottlenecks without breaking the offline mock gate.

---

## 2. Detailed Work Breakdown

### 27.1 — Parallel Live Execution (Concurrency Pool)
* **Goal**: Enable concurrent task execution in live mode while keeping mock mode deterministic.
* **Requirements**:
  * Add `--concurrency <N>` flag (default `1` for mock mode, configurable `1–8` for live mode).
  * Implement a bounded Promise worker pool in [`packages/core/src/eval/runner.ts`](../packages/core/src/eval/runner.ts) without external dependencies.
  * Ensure progress logs (`[1/15] ...`) and report results remain properly ordered.
  * Respect provider rate limits: configurable delay or concurrency clamp per provider.
* **Target Metric**: Full 15-task live eval run completed in $\le$ 2 minutes at `--concurrency 4`.

### 27.2 — Multi-Language Benchmark Fixtures (Python & TypeScript)
* **Goal**: Expand the fixture suite from 15 to 25 benchmark tasks across diverse tech stacks.
* **Fixtures to Add**:
  * **TypeScript**:
    * `16-feature-ts-generics`: Implement a type-safe generic event emitter (asserts runtime pass + `npx tsc --noEmit`).
    * `17-bugfix-ts-narrowing`: Fix a discriminated union type mismatch in an API client.
  * **Python**:
    * `18-bugfix-py-off-by-one`: Correct slice bounds in a data processor (asserts `python3 -m unittest test_processor.py`).
    * `19-feature-py-lru-cache`: Implement a bounded decorator cache.
    * `20-refactor-py-dataclass`: Migrate raw dictionary config to typed `@dataclass`.
* **Assertion Standard**: Every task must provide an idempotent `assertions/check.sh` and offline mock fixtures in `assertions/expected/`.

### 27.3 — Failure Diff Snapshots
* **Goal**: Instantly show *what* the model wrote when a task fails.
* **Requirements**:
  * In `runEvalTask()`, before removing the temporary sandbox in `finally`, if `!passed`:
    * Execute `git diff` or compare initial sandbox files against current state.
    * Populate `failureDiff?: string` on `EvalResult`.
  * Persist failure diffs under `~/.anvil/evals/<run-id>/failures/<task-id>.diff`.
  * Include unified diff snippets in `formatEvalReport()` when printing failed tasks.

### 27.4 — Multi-Turn Diagnostic Tasks
* **Goal**: Test Anvil's iterative tool loop and self-healing abilities.
* **Requirements**:
  * Create tasks where `setup/` contains a broken test suite with complex stack traces.
  * The prompt instructs: *"Run project tests, diagnose the failures across the codebase, fix the implementation, and verify all tests pass."*
  * Requires the agent to use `verify_tests`, `grep`, `read_file`, and `edit_file` in multiple turns.

### 27.5 — Real-Time Dollar Cost Estimation
* **Goal**: Display accurate API expenditure for every benchmark run.
* **Requirements**:
  * Add pricing tables (`costPer1kInputTokens`, `costPer1kOutputTokens`) to model definitions in `packages/core/src/providers/registry.ts`.
  * Compute `estimatedCostUsd` in `createEvalReport()`:
    $$\text{Cost} = \frac{\text{inputTokens} \times P_{\text{in}} + \text{outputTokens} \times P_{\text{out}}}{1000}$$
  * Display total cost and per-task cost in `formatEvalReport()` and `npm run eval:report`.

### 27.6 — CI Live Eval Hardening
* **Goal**: Ensure GitHub Actions artifact upload never fails due to tilde (`~`) expansion.
* **Requirements**:
  * In [`.github/workflows/live-eval.yml`](../.github/workflows/live-eval.yml), set `ANVIL_HOME: ${{ github.workspace }}/.anvil` in the workflow environment.
  * Set upload artifact path to `.anvil/evals/`.
  * Regenerate and commit SHA-256 hash in `scripts/gate-manifest.json`.

---

## 3. Acceptance Criteria

| ID | Requirement | Test Target |
| :--- | :--- | :--- |
| **E1** | `--concurrency` flag runs tasks concurrently in live mode and maintains ordered reports | `eval/runner.test.ts` |
| **E2** | TypeScript and Python tasks pass in both `--mock` and live modes | `evals/run.ts` |
| **E3** | Failed tasks capture and save unified diff in `EvalResult.failureDiff` | `eval/report.test.ts` |
| **E4** | Evaluation reports calculate and display estimated USD cost | `eval/report.test.ts` |
| **E5** | GitHub Actions `live-eval.yml` artifact upload succeeds without path warnings | CI workflow run |
| **E6** | All 15 existing Phase 17 tasks pass with zero regressions | `npm run gate` |

---

## 4. Non-Goals

* No migration to heavyweight container frameworks (like Docker / SWE-bench); Anvil evals remain native and lightweight.
* No subjective LLM-as-a-judge scoring; all verification must remain strictly deterministic via shell assertions (`check.sh`).
