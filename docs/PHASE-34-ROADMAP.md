# Phase 34 — Sub-Agent Streaming Visibility

> **Version:** v1.7.0 → v1.8.0  
> **Date:** 2026-09-28  
> **Author:** Chief Engineer  
> **Core Mandate:** *"We are not making some cheap copy here; we are building frontier coding tools."*  
> **Status:** ACTIVE  
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
| **34.1** | Per-member lifecycle events out of `runTeam` (started / finished / failed / aborted), opt-in via `TeamRunnerDeps` so existing callers are untouched | The runner currently reports only the merged end state | **P0** | **PENDING** |
| **34.2** | Thread the events through `delegate_task`'s tool-generator protocol so they stream as normal `AgentEvent`s | One spinner for the whole run | **P0** | **PENDING** |
| **34.3** | TUI rendering: a member row per active sub-agent (id, status glyph, tool count, tokens), replacing the static card during the run | The user cannot tell a healthy run from a hung one | **P1** | **PENDING** |
| **34.4** | Honesty checks: a member's failure must not be laundrered into a "completed" run; aborted members keep their `aborted` flag; guardian still intercepts sub-agent tool calls | Partial success must never read as success | **P1** | **PENDING** |
| **34.5** | Guardian gate, docs sync, record | — | **P0** | **PENDING** |

---

## 3. Constraints

- **No breaking change to `TeamRunResult`**: the merged report remains the tool's
  `output`; streaming is additive.
- **Permission model unchanged**: sub-agent tool calls already pass through the
  same permission broker and guardian intercept — events are read-only telemetry
  and must not create a side channel around it.
- **Checkpoints unchanged**: `mergeSubCheckpoints` timing is not altered by events.
- Batched emission is acceptable as a first step (per-member granularity, not
  per-tool-call) if per-tool streaming proves to complicate the generator contract;
  the roadmap should say which was chosen and why.
