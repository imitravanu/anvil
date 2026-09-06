# PHASE 16 SPEC — v0.6.0 Hardening, Security & Release

> **Status:** PREPARED (Directive: "prepare", 2026-09-06) — ready for implementation
> **Author:** Chief Engineer
> **Target:** Anvil v0.6.0
> **Origin:** Full audit of the uncommitted Phase 11–15 wave (static review + live runs in a scratch `ANVIL_HOME`, 2026-09-06). Findings recorded in the audit; this spec converts them into a fix list with acceptance criteria.

---

## 0. Objective

The Phase 11–15 wave is feature-complete and green (typecheck, build, 374/374 tests), but the audit found **one critical security hole, several honesty/robustness defects, and two flows never live-verified**. This phase hardens the wave to releasable quality and ships v0.6.0. No new features.

Guiding rule: a record or release is only written *after* the thing it describes has been verified — the `MAINTENANCE-RECORD.md` "Typecheck: SUCCESS" incident is the anti-pattern to eliminate.

---

## 1. Fix List

### 16.1 CRITICAL — `verify_tests` shell injection (SEC)

**Current:** `runTestVerification` builds `${baseCommand} -- ${pattern}` and executes it via
`spawn("bash", ["-c", fullCommand])`. `pattern` is model-controlled and the tool is
`mutating: false`, so arbitrary shell (`x; touch /tmp/canary` — proven with a canary during the
audit) executes with **no permission prompt**, including headless runs without `-y`.

**Fix (`packages/core/src/tools/verifyTests.ts`):**
- Stop going through a shell. Detect the runner, then spawn it as an **argv array** with the
  pattern as a separate argument:
  - npm → `spawn("npm", ["test", "--", pattern])`
  - cargo → `spawn("cargo", ["test", pattern])`
  - pytest → `spawn("python", ["-m", "pytest", pattern])` (or `pytest` directly)
  - go → `spawn("go", ["test", "-run", pattern, "./..."])`
- `detectTestCommand` becomes `detectTestRunner(projectRoot): { argv: string[]; label: string } | null`.
  Keep the display label (e.g. `npm test`) for events/UI.
- The session-level auto-verify path (`session.ts`) uses the same argv form; `autoVerify` as an
  explicit command string (string form) keeps its current meaning but is also split on shell
  words with **no** `shell:` spawn option.
- Sanitize the pattern: reject `null` bytes; no other filtering needed once no shell is involved.
- `stdio: ["ignore", "pipe", "pipe"]` — the child's stdin must not stay an open pipe (interactive
  runners currently hang until the 60s timeout).
- Env: keep sanitization but pass `HOME` and `PATH` (npm needs `HOME` for its cache); add
  `NO_COLOR=1` and `CI=1` for stable output.
- Portability: resolve the runner binary via `process.platform` (`npm.cmd` on win32); do not
  hard-code `bash`.

**Acceptance:** a unit test proves `pattern: "x; touch <canary>"` results in a failed test run
(pattern treated as a literal test filter) and **no** canary file. Existing `verifyTests.test.ts`
extended for all four runners.

### 16.2 Goal-engine honesty (`packages/core/src/agent/goal/goalEngine.ts`)

Audit findings (all reproduced live): milestones are marked `completed` unconditionally; a trivial
goal fell back to the generic 3-phase plan; the adversarial critique printed an **empty verdict**.

**Fix:**
1. **Evidence-gated completion.** A milestone is `completed` only if its turn ended without an
   error event AND (when mutations occurred) verification passed. Otherwise → `failed` with
   `summary` describing what blocked it. `GoalMilestone.status` gains `"failed"`.
2. **Critique placement.** Run the adversarial critique *per milestone* (cheap, same session)
   after verification, and keep the final overall critique; a failed critique verdict on a
   milestone flips it to `failed`. Decision recorded: **failed milestones do NOT abort the run —
   continue to the next milestone, report failed in the HUD/debrief, and let
   `GoalRunResult.success` require all milestones genuinely completed.**
3. **Non-empty critique.** If the critique turn yields no text (observed live), re-ask once;
   if still empty, emit a deterministic verdict summarizing the turn/error ledger instead of
   printing an empty block.
4. **Decomposition quality.** Strengthen the planning prompt (explicit "respond with ONLY a JSON
   array, no prose") and, on fallback, scale milestones to the goal (a single-artifact goal gets
   1 milestone, not 3 phases). Fallback stays deterministic.
5. **Fail-fast on permissions.** If no `-y` and the first mutating tool is refused in goal mode,
   abort with `goal_failed: "Goal mode requires --yes (mutating tools are refused in non-
   interactive mode)"` instead of burning all 10 turns.

**Acceptance:** unit tests for evidence-gating (verify-fail → `failed`), empty-critique recovery,
and scaled fallback; MissionDeck renders `[✗]` for failed milestones.

### 16.3 Surface verification events outside the TUI

`headless.ts` and `goalRunner.ts` silently drop `verification_started` / `verification_result`.
**Fix:** handle both — stderr lines `🧪 [verify] running npm test…` / `🧪 [verify] PASS (12s)` /
`🧪 [verify] FAIL (exit 1)`, `--raw` suppresses. Acceptance: live headless run against a failing
suite shows the lines.

### 16.4 Cockpit Header unborn-HEAD fix (`agent/goal/awareness.ts`)

`git rev-parse --abbrev-ref HEAD` fails on a repo with zero commits → Header shows "no-git" for a
real repo (reproduced live). **Fix:** check `git rev-parse --is-inside-work-tree` first; for the
branch use `git branch --show-current` (falls back to `HEAD (unborn)`). Acceptance: unit test +
live frame.

### 16.5 Session robustness nits (`agent/session.ts`, `providers/freeModels.ts`)

1. `mutationsOccurred`: only set when the outcome exists and is not an error (missing outcomes
   after a cancelled batch must not count).
2. Circuit-breaker accounting: one 429 must count as **one** failure (currently
   `noteRateLimited` + `recordFailure` can double-count); `clearRateLimitRecord` must not be
   called on an *open* circuit (it resets backoff); non-rate-limit transport errors must NOT open
   the circuit (keep them out of `recordFailure` — the deterministic-404 test recipe depends on
   repeated 404s not tripping it).
3. Expose circuit state on the existing rate-limit notice so the TUI can say "provider cooling
   down" instead of a bare retry countdown when the circuit is open.

### 16.6 CHANGELOG voice + records discipline

- Rewrite the Unreleased "Added" entries in plain Keep-a-Changelog style (drop "transcends
  commodity AI wrappers", "cognitive self-understanding"; keep the facts).
- Append an **Audit Record** (`docs/AUDIT-2026-09-06.md`) capturing what was live-verified and
  what this phase fixed — written *after* the fixes pass their checks.

### 16.7 Live verification of never-run flows

Scratch `ANVIL_HOME` + tmux recipe: `/diff` DiffModal (word-diff, multi-file nav), `/rewind`
RewindModal (timeline + Enter rollback), MissionDeck during a real `/goal`, Header <80-col
collapse, and a failing-test VerificationCard in the TUI. Gemini free tier is 5 req/min — space
calls or use the auto-retry.

---

## 2. Execution Order

1. 16.1 (security) → 2. 16.2 (goal honesty) → 3. 16.3–16.5 (small fixes, one pass) →
4. full test + typecheck + build → 5. 16.6 (changelog/records) → 6. 16.7 (live pass) →
7. release v0.6.0 per the standard process (CHANGELOG dated, bump `version.ts` + pins, build,
`npm pack -w packages/cli`, global install, tag `v0.6.0`).

## 3. Non-goals

No eval harness, provider certification, memory, or distribution work — that is the Phase 17–20
roadmap (`docs/ROADMAP.md`). No new features beyond the fixes above.
