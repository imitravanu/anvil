# Phase 34 — Sub-Agent Streaming Visibility

> **Version:** v1.7.0 → v1.8.0  
> **Date:** 2026-09-28  
> **Author:** Chief Engineer  
> **Core Mandate:** *"We are not making some cheap copy here; we are building frontier coding tools."*  
> **Status:** COMPLETE (2026-09-28) — successor: [`PHASE-35-ROADMAP.md`](PHASE-35-ROADMAP.md)  
> **Scope:** During a multi-agent team run, the user currently stares at a spinning `delegate_task` card for the entire duration. This phase makes sub-agent work *visible while it happens* — per-member lifecycle events surfaced through the same event stream the TUI already consumes — without breaking the permission model, checkpoints, or the guardian.

---

## 1. The verified problem

Checked against the live tree, not assumed (Phase 32's method, again):

- `agent/team/runner.ts` runs members via `Promise.all` (`parallel`/`review`) or a
  serial pipeline, and only the **final** `TeamRunResult` is handed back — through
  `ctx.onTeamRunResult` in `tools/delegateTask.ts`, stored as
  `session.lastTeamRun` in `agent/session.ts` line ~642.
- The tool's `ToolExecutionResult` therefore only exists when the whole team has
  finished. Every per-member event (member started, member's tool calls, member
  finished/failed/aborted) is invisible until then.
- User-visible effect: for a multi-minute team run the TUI shows one spinner and
  nothing else. A member that fails at second 10 of a 5-minute run is silent until
  the end — the failure the user most needs to see early is the one surfaced last.

The `TeamRunnerDeps.runMember` seam already exists and is session-owned, so the
fix is a plumbing decision, not an architecture change: emit per-member events
from the runner, thread them through `delegateTask`'s execution path, and let the
existing generator-based tool protocol carry them to the TUI.

---

## 2. Wave sequence

| Task | Focus Area | Impact | Priority | Status |
| :--- | :--- | :--- | :---: | :---: |
| **34.1** | Per-member lifecycle events out of `runTeam` (started / finished / failed / aborted), opt-in via `TeamRunnerDeps` so existing callers are untouched | The runner currently reports only the merged end state | **P0** | **COMPLETE** |
| **34.2** | Thread the events through `delegate_task`'s tool-generator protocol so they stream as normal `AgentEvent`s | One spinner for the whole run | **P0** | **COMPLETE** |
| **34.3** | TUI rendering: a member row per active sub-agent (id, status glyph, tool count, tokens), replacing the static card during the run | The user cannot tell a healthy run from a hung one | **P1** | **COMPLETE** |
| **34.4** | Honesty checks: a member's failure must not be laundrered into a "completed" run; aborted members keep their `aborted` flag; guardian still intercepts sub-agent tool calls | Partial success must never read as success | **P1** | **COMPLETE** |
| **34.5** | Guardian gate, docs sync, record | — | **P0** | **COMPLETE** |

---

## 3. What was done

**34.1 — `instrumentRunner` (`agent/team/types.ts`).** `TeamRunnerDeps` gains an
optional `onMemberEvent(memberId, event)` and the runner wraps `runMember` so
`member_started` / `member_finished` / `member_failed` fire inside its own
sequencing — parallel fan-out, pipeline handoff — instead of after the whole team
settles. No listener means the identity wrapper: zero behavior change for
existing callers, tests and mocks included.

**34.2 — live drain (`tools/delegateTask.ts`).** The old code buffered every
member's events and drained them **after** `runTeam` resolved — its own comment
admitted "cross-member streaming isn't live". Now each member's events flush
through the generator the moment the runner announces its transition, so member
B's activity appears while member A is still running. The flush is an
event-driven queue with a one-shot wake resolve: the emitter never blocks, which
is also what keeps the pipeline strategy deadlock-free (member N starts after
N-1's `member_finished` is already queued).

**34.3 — TUI.** `eventReducer.ts` already rendered all three `subagent_*` events
into live member rows; nothing needed changing there. What changed is *when*: the
rows appear while the run is in flight instead of all at once at the end.

**34.4 — honesty.** The discriminator test pins the interleaving; a second test
proves a failed member (script exhausted) still yields both `subagent_started`
AND `subagent_finished`, with the ledger carrying `outcome: "error"` — never a
laundered green team. A member failing before producing any events still gets a
terminating event so its stream cannot hang.

**Mutation check:** reverting only `delegateTask.ts` (the batching) makes the
discriminator fail with "member B started only after member A finished —
streaming is still batched"; the other three tests keep passing on both sides,
as they should — they assert semantics that did not change.

**Declared granularity (the pre-authorized first step):** events stream at
per-MEMBER granularity. A member's internal tool-by-tool `subagent_progress`
events still arrive with that member's flush — `subagent_progress` per tool call
across members requires yielding the member's generator directly into the team
path, a larger protocol change deliberately deferred. Recorded, not hidden.

**A probe worth remembering:** the first version of the failure test asserted a
`tool_finished` event that never comes — delegate_task is a session tool whose
result reaches the model via the tool_result in history, not the event stream
(a phase-8 contract). A deliberate-diff probe printed the real sequence and
corrected the assertion. Probe when surprised; do not argue with a failing
test you did not yet understand.

### 34.5 — evidence

Full gate Steps 0-5 green: 177 files, **1,273 tests** (cli 122 · core 821 · tui
330), 25/25 mock evals, anti-slop scanner clean.

## 4. Constraints (superseded where noted)

- **No breaking change to `TeamRunResult`**: the merged report remains the tool's
  `output`; streaming is additive.
- **Permission model unchanged**: sub-agent tool calls already pass through the
  same permission broker and guardian intercept — events are read-only telemetry
  and must not create a side channel around it.
- **Checkpoints unchanged**: `mergeSubCheckpoints` timing is not altered by events.
- Batched emission is acceptable as a first step (per-member granularity, not
  per-tool-call) if per-tool streaming proves to complicate the generator contract;
  the roadmap should say which was chosen and why.
