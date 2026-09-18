# Phase 26 — Guardian Everywhere: Productize the Immune System (v1.1.0) — SPEC

> **Priority:** FLAGSHIP DIFFERENTIATOR. Phases 21–25 shipped the guardian engine (25.6) and
> closed release criteria (25.7). Phase 26 turns the engine into Anvil's visible product
> identity: guarding the user's work *naturally* — in any project, with any agent/model,
> continuously — and showing the user what was guarded and why.
>
> **Positioning context (2026-09-19):** coding-agent CLIs are numerous and largely
> undifferentiated. Anvil's unique claim is the built-in mechanical immune system against AI
> slop — proven at three layers (turn interceptor, native `anvil gate`, repo pipeline) and
> model-agnostic by construction. Phase 26's job is to make that claim *visible and
> measurable*, not to build a new engine.

## Entry Protocol (per AGENTS.md §1)

- Read `docs/PHASE-21-25-ROADMAP.md` §25.6 (the engine phase) and this spec before work.
- **Reality check (2026-09-19, verified):** interceptor wired at `session.ts:538-656`
  (`guardian_blocked` feedback loop live); `anvil gate` bundled and verified working outside
  the repo (`/tmp` probe); scanner/interceptor/init tested. Nothing here rebuilds those.
- Reuse existing seams: `scanDiffForSlop` / `interceptTurn` / `autoFixRawErrorFormat`
  (core guardian), `guardian/init.ts` provisioning, `getEnvNumber` + `constants.ts`
  (config), `terminalRenderer.ts` event switch (TUI surface), `evals/run.ts` +
  `ANVIL_EVAL_TIMEOUT_MS` (proof harness), repo split-literal + named-constant conventions.

## 26.0 — Internal Wiring Hardening (audit findings, P0 — before any product surface)

**Goal:** the 2026-09-19 internal wiring audit found one defect and two dead-letter seams
in the shipped guardian. Fix the defect now; the seams gate the phase work that needs them.

- ✅ **FIXED (2026-09-19):** same-path auto-fix cross-contamination.
  `InterceptResult.fixed` was path-keyed; a turn with two pending edits to one file fed
  the first repair to both inputs (stale content). Now positional: `fixed[]` carries
  `index` into the pending list; `guardianFixedText()` is the single diff-stripping seam;
  consumer-level RED→GREEN test at `guardianDispatch.test.ts` (two same-path edits,
  different raw-error patterns, byte-verified independence).
- **project-rules → scanner bridge (26.4 prerequisite):** `loadProjectRules` currently
  feeds prompts only (`buildSystemPrompt`); `scanDiffForSlop` never reads `AGENTS.md`.
  User rules are advice, not enforcement. Bridge must reuse the split-literal fixture
  convention and load once per session, not per call.
- **allowlist reader (26.5 prerequisite):** `guardedInit` writes `.fresh-allowlist.json`;
  nothing reads it back. Legacy-drain telemetry has no data source until this exists.

## 26.1 — Guardian Turn Report (the missing last mile)

**Goal:** after every turn with guardian activity, render one compact, plain-language block:
what was blocked, which rule family, whether auto-fixed or needs human eyes, and the
one-line lesson. Turn guardian from invisible plumbing into the product's visible identity.

- Core: extend `InterceptResult` with structured `violations[]`
  (`{ rule, family, path, line, message, autofixed }`) instead of only counts —
  renderer shouldn't re-parse reasons from strings.
- CLI renderer: `guardian_blocked` (and turn-end) case renders the report block;
  keep non-TTY stderr line for scripts (`guardian_blocked count=N fixed=M` stays valid).
- Copy discipline (constitution): say what was blocked and why in user language
  ("hardcoded color in `Button.tsx:12` — use the theme token instead"), never generic
  filler; no slop in the slop-fighter.
- Tests first (RED→GREEN): report renders for blocked/autofixed/mixed turns; zero-guardian
  turns render nothing; non-TTY format stable (snapshot).

## 26.2 — `anvil gate --watch` (continuous natural guarding)

**Goal:** guard the working tree the whole session, not just at turn ends — the "naturally
guarding" feel. Watch mode re-scans the diff on file-change debounce and surfaces
violations as they appear, so slop never gets a chance to accumulate unnoticed.


## 26.3 — Model-Agnostic Proof (the headline number)

**Goal:** produce the differentiating evidence: *guardian makes a weak/free model behave
like a careful one.* Run the 15-task benchmark with guardian on vs. off across at least one
free model and one frontier model; publish the pass-rate delta table.

- Harness: `evals/run.ts` gains `--guardian=on|off` (env `ANVIL_EVAL_GUARDIAN`, default on
  to match product behavior); runner seeds sessions accordingly. Named constants only.
- Matrix: ≥1 free OpenRouter model (e.g. `deepseek-v4-flash:free`) + ≥1 frontier; reuse
  `ANVIL_EVAL_TIMEOUT_MS` override for live lanes (Phase 25.7 precedent).
- Report: extend eval report with a guardian delta section (same tasks, same seed, only
  guardian toggled); write both runs' reports under `ANVIL_HOME/evals/`.
- Acceptance: publish the delta table in the progress record; a README claim only if the
  delta is real. If the delta is ~0, that is also a result — record it honestly
  (constitution: no manufactured wins).
- Tests: flag parsing, both-paths seeding, report section presence.

## 26.4 — Guarded Init for Foreign Agents (guard the *other* agents' work too)

**Goal:** the differentiator no frontier agent offers: `anvil init --guarded` makes *any*
repo — including ones edited by other tools/agents — enforce Anvil's rules at its gates.
Guardian becomes infrastructure, not just in-app behavior.

- Verify/extend `guardian/init.ts` provisioning for TS/Python/Rust/Go tails
  (AGENTS.md + allowlist + pre-commit hook calling the same `scanDiffForSlop` rules).
- **Audit note (2026-09-19):** confirmed `guardedInit` today writes only AGENTS.md +
  allowlist — no hook exists yet. This subsection CREATES it; its acceptance is a real
  blocked commit in a throwaway repo, not a unit test alone.
- Audit note (2026-09-19): confirmed `loadProjectRules` feeds prompts only. The
  rules→scanner bridge (26.0) ships here if not landed earlier.
- The provisioned hook degrades gracefully without Anvil installed (clear error, non-zero
  exit — never silently pass).
- Acceptance: provisioning works in a throwaway non-Anvil repo; the hook blocks a planted
  slop commit; drain-rate telemetry lands in the 26.5 report.
- Tests: provisioning matrix per language, hook block/allow cases, no-Anvil degradation.

## 26.5 — Codebase Health Telemetry (close 25.6 deliverable 4)

**Goal:** ship the adaptive-ratchet story 25.6 promised: freshness metrics, duplication
score, allowlist drain rate — tracked across sessions, surfaced via `anvil health`.

- Metrics computed from existing allowlist inventory + scan results (no ad-hoc
  heuristics; extend scanner outputs where needed, named constants only).
- **Audit note (2026-09-19):** `.fresh-allowlist.json` is currently write-only
  (`guardedInit` writes it; no reader exists). 26.5 must add the reader as part of the
  telemetry contract — a drain rate needs a drain source.
- Storage under `ANVIL_HOME/health/<project-hash>.json`; latest-only render in CLI.

## Release Criteria (all must be green)

- [ ] 26.1 report block ships with tests (RED→GREEN proven)
- [ ] `anvil gate --watch` ships with debounce + banner tests
- [ ] Guardian delta table published from real live runs (or honest null result recorded)
- [ ] Foreign-agent provisioning verified in a non-Anvil repo
- [ ] `anvil health` renders drain-rate + freshness across two sessions
- [ ] Full `npm run gate` green; no new magic numbers; no `--no-verify`

## Non-Goals

- No new rule families in this phase (engine breadth was 25.6; this is product surface).
- No third-party-agent protocol work beyond 26.4's provisioning (git hooks are the seam).
- No paid-model-only proof: the matrix must include a free-tier model (Phase 25.7 lesson).

## Sequencing

26.1 → 26.2 → 26.3 (proof needs the report UX to be visible) → 26.4 → 26.5. Gate stays
green at every landing; each subsection lands as its own commit with RED→GREEN evidence.

- Reuse `scanDiffForSlop` on a debounce (no new scanner); budget-bounded via
  `GUARDIAN_WATCH_*` env constants (interval, max events/min — named, no magic numbers).
- `guardian_blocked`-style events feed the same 26.1 report path — one UX, two triggers.
- Honesty rule: watch mode reports what *it* can see (diff vs HEAD); say so in its banner,
  never claim full-tree coverage it doesn't do (the repo gate's step 1.5 does that).
- Tests: debounce coalescing, violation surfacing, clean-tree silence, banner copy.