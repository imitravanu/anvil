# PHASE 17 PROGRESS — Verification Harness (Agent Evals)

> **Status:** COMPLETED & VERIFIED (2026-09-10)
> **Author:** Chief Engineer
> **Target:** Anvil v0.8.0
> **Spec:** [ANVIL-COMPLETE-ROADMAP.md §6](ANVIL-COMPLETE-ROADMAP.md#6-phase-17--verification-harness-agent-evals)

---

## 1. Objective Achieved

Built a reproducible, deterministic evaluation harness that benchmarks Anvil's agent loop on real-world coding tasks (bug fixes, feature implementations, API migrations, regression repairs, multi-file refactoring, and configuration management).

Scoring relies strictly on deterministic file and state assertions (`check.sh`) rather than flaky LLM-as-judge heuristics.

---

## 2. Deliverables & Implementation

### A. Core Eval Subsystem (`packages/core/src/eval/`)
1. **`types.ts`**: Formalized `EvalTask`, `EvalResult`, `EvalReport`, and `EvalRunnerOptions`.
2. **`runner.ts`**: Discovers tasks from `evals/tasks/`, prepares isolated temporary directories per task, drives `AgentSession` with timeout and token tracking, executes assertions, and calculates metrics.
3. **`report.ts`**: Aggregates pass rate, duration, and token usage; formats terminal reports and historical trend comparison tables; persists reports atomically to `ANVIL_HOME/evals/<date>/report.json`.
4. **`mockProvider.ts`**: Deterministic mock provider enabling 100% offline, zero-spend CI gates.
5. **`__tests__/runner.test.ts`**: 6 unit tests covering task loading, execution, report aggregation, and trend comparison.

### B. Fixture Suite (`evals/tasks/` — 15 Tasks)
- **Bug Fixes:**
  - `01-bugfix-calc-divzero`: Zero-division error guard
  - `02-bugfix-off-by-one`: Pagination offset computation
  - `03-bugfix-json-parse`: Safe JSON fallback on malformed input
- **Features:**
  - `04-feature-calc-modulo`: Modulo operation with division-by-zero check
  - `05-feature-string-slugify`: Text slugification with punctuation stripping
  - `06-feature-array-chunk`: Array partitioning helper
  - `15-feature-lru-cache`: Bounded cache with oldest-key eviction
- **Migrations:**
  - `07-migration-deprecated-api`: Multi-service API deprecation migration
  - `08-migration-config-rename`: Server config restructuring into nested objects
- **Regressions:**
  - `09-regression-filter-active`: Restoring soft-deleted user exclusion
  - `10-regression-sort-order`: Inverting ascending to descending priority sort
- **Multi-File Refactoring:**
  - `11-multifile-extract-interface`: Extracting shared constants across modules
  - `12-multifile-export-barrel`: Creating barrel index re-exports
- **Configuration:**
  - `13-config-add-build-script`: Adding build and lint npm scripts
  - `14-config-env-defaults`: Appending database pool configuration defaults

### C. CLI & Tooling Integration
- **`evals/run.ts`**: Standalone evaluation runner supporting `--mock`, `--fast`, `--filter <name>`, `--provider <id>`, `--model <id>`, and `--report`.
- **Root `package.json`**:
  - `npm run eval`: Runs evaluation suite
  - `npm run eval:report`: Displays historical trend comparison
- **GitHub Actions (`.github/workflows/ci.yml`)**: Added automated fast eval gate running on every push/PR.

---

## 3. Acceptance Criteria Verification

| ID | Requirement | Verification | Status |
|:---|:---|:---|:---|
| **E1** | At least 15 reproducible tasks exist with setup dirs and assertion scripts | 15 task directories in `evals/tasks/` across 6 categories | ✅ PASS |
| **E2** | `npm run eval` runs all tasks headlessly and produces a JSON report | Executed `npm run eval -- --fast --mock`; produced `report.json` in `ANVIL_HOME/evals/` | ✅ PASS |
| **E3** | Deterministic pass/fail assertions (no LLM judgment) | All 15 tasks scored by `assertions/check.sh` exit code | ✅ PASS |
| **E4** | Report includes wall-clock, token spend, and tool call count | Captured in `EvalResult` and surfaced in terminal report | ✅ PASS |
| **E5** | Trend comparison: `npm run eval:report` compares runs | Verified via `npm run eval:report` showing tabular history | ✅ PASS |
| **E6** | CI integration on fast subset | Added `npm run eval -- --fast --mock` step to `ci.yml` | ✅ PASS |
| **E7** | All existing tests still pass | 466 unit tests passed, 96 visual baselines passed | ✅ PASS |

---

## 4. Verification Gate Results (Post-Phase 17)

```
- @anvil/core: 45 test files, 315 tests passed
- @anvil/tui:  27 test files, 143 tests passed
- @anvil/cli:   2 test files,   8 tests passed
- Visual Matrix: 96 / 96 scenarios passed at 0.0% drift
- Eval Harness:  15 / 15 tasks passed in 0.9s
- Monorepo Build & Typecheck: SUCCESS
```
