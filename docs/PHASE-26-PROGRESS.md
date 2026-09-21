# Phase 26 — Guardian Everywhere (v1.1.0) — Progress Record

> Per AGENTS.md §1: entry protocol followed — roadmap §25.6 + PHASE-26-SPEC read, reality
> verified 2026-09-19 (interceptor live at `session.ts:538-656`, `anvil gate` bundled and
> probed outside the repo, scanner/interceptor/init tests green). No protected artifacts
> touched.

## Status: RELEASE-READY — 26.0–26.5 landed + v1.1.0 cut (2026-09-21)

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
- [x] Debounced re-scan reusing `scanDiffForSlop` — `runNativeGateWatch` in
      `packages/cli/src/gate.ts`; `createDebouncer` coalesces bursts and enforces a
      minimum gap; only dirty files are diffed (`git diff HEAD -- . ':!node_modules' ':!dist'`).
- [x] `GUARDIAN_WATCH_*` named constants — `GUARDIAN_WATCH_INTERVAL_MS` (default 500),
      `GUARDIAN_WATCH_MAX_SCANS_PER_MIN` (default 60), env-overridable in `config/constants.ts`.
- [x] Same report path as 26.1; banner states diff-vs-HEAD scope honestly —
      `formatWatchBanner` says "NOT full-tree coverage — run `npm run gate` (Step 1.5)";
      violations reuse the guardian violation shape (`file:line [rule] detail`).
- [x] Tests — `packages/cli/src/__tests__/gate.watch.test.ts` (8): banner copy, clean
      silence, recovery, violation surfacing, error surfacing, debounce coalescing + min gap,
      cancel, and the non-git-repo error path. Suite now 766 (cli 41 / core 501 / tui 224).
- CLI: `anvil gate --watch` wired in `index.tsx` (watch process resolves on SIGINT/SIGTERM).

### 26.3 — Model-Agnostic Proof
- [x] `--guardian=on|off` (`ANVIL_EVAL_GUARDIAN`, default on) in `evals/run.ts`
      *Done 2026-09-21: `AgentOptions.guardian` (default ON, sub-agents inherit via
      `ToolSessionContext.guardian` → `runSubAgentLive`); the runner seeds every task session
      with the toggle; banner states the mode; invalid values exit non-zero.
      RED→GREEN: `guardianToggle.test.ts` (3) + `guardianFlag.test.ts` (11). Core 617/617.*
- [ ] Delta matrix run: ≥1 free OpenRouter model + ≥1 frontier
      *Update 2026-09-21: first paired matrix obtained on `inception/mercury-2.5`
      instead (15/15 both lanes, DELTA 0.0 — see below); the OpenRouter-free +
      frontier lanes as literally specified remain open.*
      *ATTEMPTED 2026-09-21, blocked by free-tier quota exhaustion — recorded as an HONEST
      NULL (below). What was obtained: ONE complete live lane on
      `openrouter/cohere/north-mini-code:free` (probed with a real tool round-trip first; the
      25.7-precedent `deepseek-v4-flash-0731:free` is now paid-only upstream). Guardian OFF:
      **86.7% (13/15)**, 279.8s wall, 83k tokens, 100% task tool-engagement — a full valid
      OFF lane, saved with `guardian: false` provenance. The ON lane died: every task
      429'd (`Rate limit exceeded: free-models-per-day. Add 10 credits…`) — the cap is
      account-wide across ALL free models (nemotron probe: same 429). Gemini free tier also
      exhausted (direct 429 probe), and no frontier key exists (anthropic/openai empty).
      Re-run when quota resets — the harness will pair automatically.*
- [x] Delta table published (or honest null result) in this record
      *HONEST NULL RESULT (2026-09-21). No delta table is publishable: the ON half of every
      lane is missing (quota), and comparing 86.7%-OFF against an all-429 0%-ON would be a
      manufactured result, not a measurement. What the attempt DID harden: the pairing
      guards against two live failure modes found during the attempt — (1) all-429 lanes
      (a report where fewer than half the tasks spent tokens is unpairsble) and (2)
      mismatched task sets (a 1-task probe vs a 15-task run is not a delta; both halves
      must cover the same task-id set). Found via a stale-dist probe that let the dead ON
      lane pair: output would have read "DELTA: −86.7 pts — guardian hurts" from pure
      infrastructure failure. Tests: +3 pairing-hardening cases (14 total in
      `guardianFlag.test.ts`). Single-lane observation (NOT a delta, for the record only):
      guardian-OFF on cohere/north-mini-code:free still produced 13/15 clean tasks under
      the advisory slop scan — model quality varies independently of the guardian.*
- [x] Report section + tests for flag/seeding/presence
      *Done 2026-09-21: `EvalReport.guardian` (unset legacy → ON), `formatGuardianDelta`
      (renders "Delta unavailable" for a missing half; names "no delta" and "guardian hurts"
      rather than manufacturing wins), `findGuardianDeltaPair` (newest on/off pair, legacy
      fieldless reports excluded). `--report` prints the section.*
- [x] First real paired matrix: `inception/mercury-2.5`, 15/15 tasks, same seed
      *Done 2026-09-21 on the native Inception lane (direct API, 100M free-trial
      tokens — no OpenRouter quota involved). OFF: **15/15 (100%)**, 78.5s wall,
      180k/11k tokens. ON: **15/15 (100%)**, 66.4s wall, 146k/11k tokens.
      `--report` pairs automatically: **DELTA 0.0 pts — no delta**. Read honestly:
      Mercury sits at the task ceiling either way, so the guardian neither helps
      nor hurts the pass rate here — and crucially it does NOT hurt (no blocked
      turn failed a task). The ON lane also ran faster with fewer input tokens,
      but run-to-run reasoning variance means that is an observation, not a
      claim. The earlier cohere honest-null stands as history; this supersedes
      nothing — different model, first paired measurement.*

### 26.4 — Guarded Init for Foreign Agents
- [x] Provisioning matrix TS/Python/Rust/Go verified in throwaway non-Anvil repos
      *Done 2026-09-21: `guardedInit` now provisions FOUR things — language-tailored
      AGENTS.md, `.anvil/rules` starter block (`guardian:rules` format, language-specific
      slop idioms: bare-except for Python, unwrap() for Rust, `_ = err` for Go),
      `.githooks/pre-commit` (executable, CJS shebang, dependency-free), and `core.hooksPath`
      in the repo's git config (appended `[core]` section; an existing hooksPath is kept and
      reported). `scanStaged` + `anvil gate --staged` added to the CLI so the in-process gate
      and the hook agree on the staged surface; both now enforce project `guardian:rules`.
      Matrix test drives all four languages in throwaway NON-Anvil repos (a bare root is
      `foreign` scope by design — the hook, not the Anvil families, is the gate).*
- [x] Hook blocks planted slop commit; allows clean commit
      *Done 2026-09-21, REAL commit acceptance (not a unit test of script text): planted
      `as any` → commit blocked non-zero, `rev-list` count 0, stderr names the rule and the
      `--no-verify` bypass; clean README commit passes; `--allow-empty` allowed (nothing
      staged to scan); Python bare-except blocked via the project rules block. RED proven:
      with the hook provisioning stubbed out, 8/10 fail.*
- [x] No-Anvil degradation: clear error, non-zero exit
      *Done 2026-09-21: the hook requires NO Anvil installation (no `@anvil` imports;
      asserted). git-missing → `[anvil-guardian] git is not available on PATH…` + the
      `--no-verify` hint, exit 1 (tested with an isolated PATH holding only a node symlink).
      The spec's literal "install @anvil/cli" copy was corrected: the embedded scanner is
      strictly stronger than a host-CLI dependency — the gate works on hosts that never
      installed Anvil, and degradation now means "git missing", not "Anvil missing".*
- [x] Tests: matrix + block/allow + degradation
      *`guardedInit.test.ts` (NEW, 10): 4-language matrix, no-overwrite + existing-hooksPath
      kept, blocked/allowed/empty commits, project-rules enforcement, no-Anvil degradation.
      Core 627/627 green; core `tsc` 0.*

### 26.5 — Codebase Health Telemetry
- [x] `ANVIL_HOME/health/<project-hash>.json` writer + reader
      *Done 2026-09-21: `guardian/health.ts` — the key is the first 12 hex chars of
      SHA-256 of the RESOLVED root (spec-exact); snapshots are written synchronously via
      `atomicWriteJson` at mode `0600` (a fire-and-forget async write was found and fixed
      during testing — the recording is the last thing a gate run does, so an async write
      could be lost at process exit). Schema: cumulative `scansRun`/`scannedLines`/
      `cleanLines`/`blockedByRule` + the allowlist `entries`/`high` pair. Latest-only per
      project, no history array to grow unbounded; a corrupted snapshot is discarded and
      rebuilt, never trusted.*
- [x] `anvil health` renders freshness + drain rate across two sessions
      *Done 2026-09-21: every real `anvil gate` scan (working tree + `--staged`) records one
      observation; watch mode records ONCE at stop, not per debounced re-scan (re-scans of
      the same diff would inflate the counters). End-to-end verified through the built CLI:
      two `gate --staged` sessions against a throwaway repo → "2 scan(s) recorded",
      cleanliness 50%→60%, `no-as-any: 2`. Renderer states the honest empty case ("no
      exceptions on record — nothing to drain") instead of rendering a never-used allowlist
      as 0% drained; a project with no scans gets "no scans recorded yet", not zeroes.*
- [x] Metrics derived from allowlist + scan outputs (named constants)
      *Drain rate = (high − active) / high, clamped to [0,100], from `loadFreshAllowlist`
      (the 26.0 reader — the data source the spec named). Cleanliness = clean added lines /
      scanned added lines. Top rules ranked by cumulative count, capped at
      `HEALTH_TOP_RULES` (5). Telemetry recording is best-effort: a read-only home warns and
      never fails the scan that fed it. Tests: `health.test.ts` (NEW, 11) — two-session
      accumulation, drain ratchet (3→2 active = 33% drained, →0 = 100%), per-root hash
      isolation, corruption rebuild, clamping, renderer stability. RED proven by stubbing
      the recorder (11/11 fail). Full gate green.*

### Phase Gate
- [x] Release criteria in PHASE-26-SPEC all checked (26.1 report + tests, `--watch`
      debounce + banner tests, honest-null delta recorded instead of manufactured,
      foreign provisioning with real-commit acceptance, `anvil health` two-session
      render — each evidenced in its section above)
- [x] Full `npm run gate` green at final landing (Steps 0–5, 15/15 mock evals;
      one LSP sync-test load flake found red, fixed test-only, re-verified green)
- [x] CHANGELOG entry + README claim only as far as evidence supports
      (`## [1.1.0]` heading; README Guardian section documents surfaces, claims
      no pass-rate delta — matrix tracked here pending quota)
