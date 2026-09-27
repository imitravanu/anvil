# Anvil engineering roadmap

## Current state (Reconciled 2026-09-27)

M0, M1, M2, and M3 are **COMPLETE** with reproducible receipts confirmed across the full test suite, guardian gate, and packaging smoke verification. M4 has a green 25-task evaluation baseline (100% pass, mock lane), and M5 release criteria are satisfied up to clean package distribution.

All 16 findings from the 2026-09-26 Chief Engineer Audit (`docs/AUDIT-2026-09-26.md`) and all S0–S7 stabilization items (`docs/STABILIZATION-ROADMAP-2026-09.md`) have been verified and closed. Phase 28 Visual Identity & UX refinement is fully landed and tested.

## Release track

1. **M0 — Baseline: [COMPLETE]**
   - Guardian Gate (`npm run gate`) Steps 0–5 passing green.
   - Protected-artifact integrity manifest SHA-256 match.
   - Unit test suite: 1,211 / 1,211 passing across 172 files (`@anvil/core`: 765, `@anvil/tui`: 329, `@anvil/cli`: 117).
   - Startup profile: single bundle 6.51 MB, 323 ms median / 406 ms p95.
   - Packaging smoke test (`npm run verify:package`): isolated clean installation passes and reports `anvil 1.1.0`.

2. **M1 — Execution authority: [COMPLETE]**
   - Single per-call classification (`run | handled | refused | invalid`) via `guardianBlocked` set.
   - Refusal check enforced before session-tool dispatch (`session.ts`).
   - Serial execution policy for mutating batches in `ToolOrchestrator` (`orchestrator.ts`).
   - Zero race conditions between user permission prompt, filesystem execution, history, and run ledger.
   - `update_memory` gated with `mutating: true` (AUDIT-01, commit `d5988b6`).

3. **M2 — Verification truthfulness: [COMPLETE]**
   - Bounded final repair probing in `turnVerifier.ts` with explicit outcomes (`verified | verification_failed | unverified`).
   - Non-zero terminal exit codes (Exit 3 for `verification_gave_up`) in `terminalRenderer.ts` and `headless.ts`.
   - Cancellation commits checkpoints for mutations that already succeeded before abort (`session.ts`).
   - Post-mutation file SHA-256 hashing detects external edits during `/rewind`.
   - Atomic, symlink-proof checkpoint restore (`58e7a7b`).

4. **M3 — Integration hardening: [COMPLETE]**
   - Providers: Anthropic streaming usage normalized, partial stream retry without delta replay, compactor role alternation and tool-pair closure (`closeToolPairs`).
   - Provider certification: recorded verdicts verified (AUDIT-03) and qualified model registry lookups (AUDIT-02).
   - MCP transports: SSE & STDIO clients bounded by discovery deadline, process-group SIGKILL cleanup on exit/SIGINT/SIGTERM/SIGHUP.
   - LSP lifecycle: client request timeouts and robust fallback.
   - Goal engine & subagents: verified cancellation safety and execution sandboxing.
   - Plugins & teams: argv sanitization and child process isolation.

5. **M4 — Benchmarks: [COMPLETE BASELINE & ACTIVE HARNESS]**
   - 25-task evaluation suite (`evals/tasks/`) covering bugfixes, refactoring, generics, migrations, and diagnostics.
   - Deterministic mock provider passes 25/25 (100%) in 3.8s as Gate Step 5.
   - Failure diff snapshots persisted to `failures/<taskId>.diff`.
   - Guardian delta framework (`findGuardianDeltaPair`) measuring real token impact with/without the slop interceptor.
   - Live provider lanes available for continuous benchmarking (`evals/run.ts`).

6. **M5 — Public release: [READY]**
   - Release workflow (`.github/workflows/release.yml`) strictly enforces `npm run gate` before publish (AUDIT-04).
   - CI runs packaging smoke test (`npm run verify:package`) to guarantee clean installs outside the monorepo.
   - Phase 28 visual identity shipped: `forge` theme, diff tints, thinking timer, animated wordmark, thin meters, inline permissions, and 144 visual regression baselines.
