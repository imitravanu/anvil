# PROGRESS — multi-agent coordination

> Per AGENTS.md §1.2: file ownership declarations for concurrent sessions.

## 2026-09-18

**Agent A (Buffy / this session)** — owns & completed:
- `packages/core/src/providers/anthropic.ts` + `providers/__tests__/anthropic.test.ts` — usage now read from flat `message_delta.usage` (real SDK `RawMessageDeltaEvent` shape, cumulative `MessageDeltaUsage`); legacy `delta.usage` shape still tolerated; stream cast reduced to a single cast.
- `packages/core/src/providers/base.ts` — removed dead `streamWithRetry` (zero callers; constitution §2.8). Live retry path unchanged.
- `packages/core/src/tools/delegateTask.ts` + `agent/__tests__/teamBudget.test.ts` — team iteration budget now enforced: `runSubAgentLive` receives the `runTeam`-computed budget (per-member `maxInnerIterations` override clamped to `[1, total]`). Was `_budget`-ignored/unbounded.
- `packages/core/src/agent/session.ts` + rewritten `agent/__tests__/guardianDispatch.test.ts` — S1.1 single dispatch decision (see Agent B note below; lane taken over after that agent stopped).
- NEW files: `PROGRESS.md` (this note), `agent/__tests__/teamBudget.test.ts`, rewritten `guardianDispatch.test.ts`.
- `packages/core/src/agent/turnVerifier.ts` + `turnVerifier.test.ts` — S1.2: final repair is
  ALWAYS verified (budget exhaustion stops repair prompts, never verification). A passing final
  repair now reports `passed`; a still-failing final state reports `verification_gave_up` backed
  by a real probe. Updated `autoVerify.test.ts` expectations (3 probes bounded, no looping).
- `packages/core/src/agent/session.ts` + `rewind.test.ts` (S1.3 block) — cancel path commits the
  pending checkpoint for succeeded calls; `commitRewindSnapshot` filters file entries to
  write/edit targets whose calls actually succeeded.
- Deterministic cancellation test uses a hung permission broker (the orchestrator's abort race)
  instead of timing heuristics.
- `packages/core/src/providers/base.ts` + `providers/__tests__/base.test.ts` — S2.2 partial-stream
  retry semantics: no delta replay after a mid-stream error (`surfaced` flag gates catch-path
  retry); abandoned iterator explicitly closed (`iterator.return`) before first-event-error retry
  (fixture suspends at a `yield` so `.return()` deterministically runs its `finally`); backoff
  abortable via `sleepAbortable`. Hoisted `sleepAbortable` from `agent/session.ts` into
  `core/errors.ts` (shared helper; session now imports it).
- `docs/STABILIZATION-ROADMAP-2026-09.md` — annotated in place: S0 and S1.1–S1.3 and S2.1/S2.2
  checkboxes marked done with dated evidence; status header updated; S1.3 rewind external-edit
  warning and S1.4/S2.3/S3–S6 explicitly left open.

**Agent B (concurrent session — STOPPED mid-task 2026-09-18 ~02:00; lane taken over by Agent A with user approval)**:
- Left behind an untracked failing-first `guardianDispatch.test.ts` (S1.1 red test). Its fixture
  used raw-error formatting, which the guardian AUTO-FIXES by design — so the test asserted a
  block that could never happen, and its literal fixture string also tripped gate Step 1.
- Agent A rewrote the test file (non-fixable `as any` fixture built from split literals + three
  new cases: mixed-batch isolation, auto-fix happy path, loop-refused session-tool ordering) and
  implemented the S1.1 fix in `packages/core/src/agent/session.ts`:
  guardian-blocked call ids collected in a `guardianBlocked` set and skipped by the dispatch loop;
  `p.refused` checked BEFORE session-tool handling (a loop-refused delegate_task/update_plan no
  longer reaches its executor). 4/4 guardian tests green; full core suite green with zero
  regressions (478 tests, 72 files).
- Net effect: a guardian refusal (or loop refusal) can no longer diverge from actual execution —
  the approved → executed → changed → verified → reported chain agrees for refused calls.

**Disjointness guarantee:** no file is touched by both agents. Root `PROGRESS.md` did not exist;
created here per the constitution's coordination requirement.
---

## 2026-09-18 — Agent C (chief-engineer verification pass)

**Owns & changed (disjoint from Agents A/B — no shared file edited):**
- `packages/core/src/agent/goal/goalEngine.ts` — `verificationFailed` is now the
  **last** verdict instead of a sticky failure. In a single `send()` a repaired turn
  emits `verification_result(false)` → `verification_result(true)`; sticky failure
  marked such a milestone failed, so with S1.2's always-probe-final change a repair
  could never rescue a milestone. `verification_gave_up` stays terminal (emitted only
  when the final state still fails).
- `packages/core/src/providers/streaming.ts` — `ToolCallAssembler.drain()` no longer
  collapses unparseable tool-call args to `{}`. It emits the existing
  `{ __parseError, rawInput }` sentinel that `executeTool` (`tools/index.ts:94`) and
  the orchestrator (`orchestrator.ts:80`) already convert into a model-visible error.
  The OpenAI-shaped stream path previously made that handling unreachable.
- Tests (new/changed): `agent/goal/__tests__/goalEngine.test.ts` (+2 cases),
  `providers/__tests__/streaming.test.ts` (split the malformed case from the
  genuinely-empty case; the old assertion encoded the `{}` behavior).

**Roadmap item classification (AGENTS.md §1.5 — recorded here because the audit doc is
a protected artifact):** item **22.2 (malformed tool-call JSON → `{}`)** — the session
path already had provenance (`session.ts` `__parseError`); the *assembler* was the
remaining LIVE hole. Status: **LIVE → FIXED** for the assembler path. The audit doc
itself was NOT edited (protected; needs human review + manifest/sentinel sync).

**Test-first evidence:** both new tests were RED before the fix (`input: {}` vs
sentinel; `milestone_failed` present) and GREEN after. Full suite: **739 passed**
(cli 30 / core 486 / tui 223), zero regressions.

**Deliberately NOT staged:** `CHANGELOG.md` carries `+135` lines of another agent's
in-flight `[Unreleased]` WIP; my entry was added to the file but left unstaged so this
commit does not bundle their work (AGENTS.md §1.2 collision guard).

---

## 2026-09-18 — Agent C pass 2 (S1.4 + release hygiene)

**Owns & changed:**
- `packages/cli/src/terminalRenderer.ts` + `__tests__/terminalRenderer.test.ts` — **S1.4
  closed**. `verification_gave_up` returned no exit code; because it precedes
  `turn_complete` and `headless.ts` returns on the FIRST exit code it sees, a turn that
  mutated files and left tests failing exited **0**. It now returns `EXIT_UNVERIFIED` (3).
  All exit codes became named constants (`EXIT_OK/ERROR/BUDGET_EXHAUSTED/UNVERIFIED/
  CANCELLED`) replacing inline literals, and the misaligned `case` indentation was fixed.
  Three new tests: give-up nonzero, real headless event order exits 3 (not 0), repaired
  failure still exits 0. **Test-first: 2 RED (`expected undefined to deeply equal
  {exitCode:3}`; `expected +0 to be 3`) → 7/7 GREEN.** Typecheck 0; cli suite 33 (was 30).
- `docs/STABILIZATION-ROADMAP-2026-09.md` — S1.4 boxes annotated; exit-code table recorded
  there as the roadmap asked; the "no test runner detected → still 0" limitation stated
  rather than hidden. Status header updated (S1.4 no longer open).
- `CHANGELOG.md` — S1.4 entry.

**Release hygiene (verification, not assertion):**
- Landed the 120-file working-tree WIP in two commits (`d049b9c` code 129 files,
  `c2f342e` docs 10 files) — it had been validated but **uncommitted**, i.e. one disk
  failure from loss. Grouped coarse because the new subsystems are imported by the modified
  call sites (`session.ts`→`guardian/`, `tools/index.ts`→`lsp/`, `cli/index.tsx`→`gate.ts`);
  finer splits would break intermediate builds.
- Tagged the provable releases only: `v0.6.3`, `v0.7.0`, `v0.8.0`, `v0.11.0` (lightweight,
  matching existing tags). NOT tagged: `v0.9.0`/`v0.9.1`/`v0.10.0` (all squashed into
  `da15273` — tagging them would fabricate history) and `v1.0.0` (its heading is not in HEAD).
- **Pre-commit hook blocked the batch commit** on 4 false positives (`as any` inside a
  comment and inside test-fixture string literals whose purpose is to test the scanner).
  Fixed via the repo's own split-literal convention, runtime strings unchanged — did NOT use
  `--no-verify`.

**Blocked / needs a human:**
- **Push impossible from here**: `git ls-remote origin` fails with "could not read Username
  for 'https://github.com'" — no credentials in this environment. Network is fine
  (openrouter reaches 200). All commits + tags are LOCAL ONLY. Needs a token/credential
  helper or a manual push.
- `v0.9.0`–`v0.10.0` tag mapping needs a human decision (squashed history).
- Phase 25.7's last box (live eval ≥80% on a real provider) still open — keys exist for
  gemini/anthropic/openai/openrouter/orcarouter.

