# Phase 26 — Guardian Everywhere (v1.1.0) — Progress Record

> Per AGENTS.md §1: entry protocol followed — roadmap §25.6 + PHASE-26-SPEC read, reality
> verified 2026-09-19 (interceptor live at `session.ts:538-656`, `anvil gate` bundled and
> probed outside the repo, scanner/interceptor/init tests green). No protected artifacts
> touched.

## Status: NOT STARTED (spec written 2026-09-19)

### 26.1 — Guardian Turn Report
- [ ] `InterceptResult.violations[]` structured (core)
- [ ] Renderer report block (blocked / autofixed / mixed / none)
- [ ] Non-TTY stderr line stays script-stable (snapshot)
- [ ] RED→GREEN evidence recorded

### 26.2 — `anvil gate --watch`
- [ ] Debounced re-scan reusing `scanDiffForSlop`
- [ ] `GUARDIAN_WATCH_*` named constants (interval, max events/min)
- [ ] Same report path as 26.1; banner states diff-vs-HEAD scope honestly
- [ ] Tests: debounce coalescing, surfacing, clean silence, banner copy

### 26.3 — Model-Agnostic Proof
- [ ] `--guardian=on|off` (`ANVIL_EVAL_GUARDIAN`, default on) in `evals/run.ts`
- [ ] Delta matrix run: ≥1 free OpenRouter model + ≥1 frontier
- [ ] Delta table published (or honest null result) in this record
- [ ] Report section + tests for flag/seeding/presence

### 26.4 — Guarded Init for Foreign Agents
- [ ] Provisioning matrix TS/Python/Rust/Go verified in throwaway non-Anvil repos
- [ ] Hook blocks planted slop commit; allows clean commit
- [ ] No-Anvil degradation: clear error, non-zero exit
- [ ] Tests: matrix + block/allow + degradation

### 26.5 — Codebase Health Telemetry
- [ ] `ANVIL_HOME/health/<project-hash>.json` writer + reader
- [ ] `anvil health` renders freshness + drain rate across two sessions
- [ ] Metrics derived from allowlist + scan outputs (named constants)

### Phase Gate
- [ ] Release criteria in PHASE-26-SPEC all checked
- [ ] Full `npm run gate` green at final landing
- [ ] CHANGELOG entry + README claim only as far as evidence supports
