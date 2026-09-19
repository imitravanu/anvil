# Phase 26 — Guardian Everywhere (v1.1.0) — Progress Record

> Per AGENTS.md §1: entry protocol followed — roadmap §25.6 + PHASE-26-SPEC read, reality
> verified 2026-09-19 (interceptor live at `session.ts:538-656`, `anvil gate` bundled and
> probed outside the repo, scanner/interceptor/init tests green). No protected artifacts
> touched.

## Status: IN PROGRESS — 26.0 complete + 26.1 landed (2026-09-19)

### 26.0 — Internal Wiring Hardening (audit 2026-09-19)
- [x] Same-path auto-fix cross-contamination FIXED (positional `fixed[].index` +
      `guardianFixedText()` seam) — RED proven (`[undefined, undefined]` vs `[0, 1]`,
      `applyGuardianFixes is not a function`), GREEN 17/17 across
      `guardian.test.ts` + `guardianDispatch.test.ts`; core + scripts typechecks 0
- [x] Consumer-level regression test: two edits, same path, one batch, different
      raw-error patterns, byte-verified independence (`guardianDispatch.test.ts`)
- [x] project-rules → scanner bridge — `guardian/rules.ts` parses the
      `<!-- guardian:rules -->` block into `CustomGuardianRule[]`; `scanTextForSlop` /
      `scanDiffForSlop` / `interceptTurn` accept custom rules; `AgentSession` loads them
      ONCE per session. Tests: `guardian/rules.test.ts` (4) + session-level
      `guardianDispatch.test.ts` case (a project block blocks a violating write).
- [x] `.fresh-allowlist.json` reader — `guardian/allowlist.ts` (`loadFreshAllowlist`),
      shape-validated against the gate's own rule (broad/malformed entries rejected,
      never half-loaded). Tests: `guardian/allowlist.test.ts` (4).

### 26.1 — Guardian Turn Report
- [x] `InterceptResult.violations[]` structured (core) — `GuardianViolation` gained
      `family: GuardianRuleFamily` + optional `autofixed`; every scanner rule is tagged;
      `InterceptResult` gained `autofixed: GuardianViolation[]`.
- [x] Renderer report block — TUI `GuardianReportCard` (blocked + auto-fixed counts,
      per-violation file:line + family label), attached via `guardianReports` on the turn's
      display message; `guardian_blocked` event now carries `violations` + `fixes`.
- [x] Non-TTY stderr line stays script-stable — raw mode keeps the exact
      `guardian_blocked count=N fixed=M` shape; human mode lists violations.
- [x] RED→GREEN evidence recorded — `guardian.test.ts` (family tags, autofixed reporting,
      custom-rule block) + `eventReducer.test.ts` (report attachment) + `guardianDispatch.test.ts`
      (project rules block). Full suite 757 (cli 33 / core 501 / tui 224) green.
- **Honest scope note:** a *pure* auto-fix turn emits no `guardian_blocked` event — the
      existing contract test (`guardianDispatch.test.ts`, "still auto-fixes … and lets the
      call run") pins that `guardian_blocked` is absent when nothing is blocked. Auto-fixed
      counts therefore render on blocked/mixed turns only; pure-fix turns stay silent by
      design, not by omission.

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
