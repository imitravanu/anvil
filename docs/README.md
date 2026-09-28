# Anvil docs — start here

71 files, one active phase. This index exists so nobody has to read all of it to know what
is current. Rule of thumb: **if a document is not listed as ACTIVE or CONTRACT, it is
history** — kept because the engineering record is genuinely valuable (it is why the code
comments cite the exact bug each rule replaces), not because it is a to-do list.

## Start here (active)

| Doc | What it is |
|---|---|
| [`../AGENTS.md`](../AGENTS.md) | The engineering constitution. Law: violations fail the gate. |
| [`../PROGRESS.md`](../PROGRESS.md) | The live engineering record (dated session entries, evidence per change). |
| [`CURRENT-FOCUS.md`](CURRENT-FOCUS.md) | **Current work** — standing state: where the project is, and the triggers that reopen work. |
| [`PHASE-35-ROADMAP.md`](PHASE-35-ROADMAP.md) | COMPLETE (2026-09-28) — declared boundaries closed; tokeniser decision taken (DEFER, with triggers). |
| [`PHASE-34-ROADMAP.md`](PHASE-34-ROADMAP.md) | COMPLETE (2026-09-28) — sub-agent streaming visibility during team runs. |
| [`PHASE-33-ROADMAP.md`](PHASE-33-ROADMAP.md) | COMPLETE (2026-09-28) — advertised capability audit: every self-claim derived or verified. |
| [`PHASE-32-ROADMAP.md`](PHASE-32-ROADMAP.md) | COMPLETE (2026-09-28) — code-intelligence integrity: the advertised language support is now real. |
| [`PHASE-31-ROADMAP.md`](PHASE-31-ROADMAP.md) | COMPLETE (2026-09-28) — frontier TUI craftsmanship & UX elevation (Ink 7 + React 19). |
| [`PHASE-30-ROADMAP.md`](PHASE-30-ROADMAP.md) | COMPLETE (2026-09-28) — deep workspace AST & semantic code graph. |
| [`PHASE-29-ROADMAP.md`](PHASE-29-ROADMAP.md) | COMPLETE (2026-09-28) — frontier presentation engine (Ink 7 + React 19). |
| [`PHASE-28-ROADMAP.md`](PHASE-28-ROADMAP.md) | COMPLETE (2026-09-26) — visual identity & UX refinement (144 baselines, forge theme, thin meters). |
| [`HARDENING-PLAN-2026-09-26.md`](HARDENING-PLAN-2026-09-26.md) | COMPLETE (2026-09-26) — the hardening plan, T1–T10, with per-task acceptance. Read its `**Status:**` line before reopening anything in it. |
| [`ENGINEERING-MEMORY.md`](ENGINEERING-MEMORY.md) | Durable engineering knowledge that outlives a phase. |
| [`ENGINEERING-ROADMAP.md`](ENGINEERING-ROADMAP.md) | Where the work is heading after the current plan. |
| [`ANTI-SLOP-GATE-PLAN.md`](ANTI-SLOP-GATE-PLAN.md) | Why the gate looks the way it does. |
| [`PHASE-21-25-ROADMAP.md`](PHASE-21-25-ROADMAP.md) | The multi-phase hardening roadmap referenced by the constitution. |
| [`STABILIZATION-ROADMAP-2026-09.md`](STABILIZATION-ROADMAP-2026-09.md) | Stabilization scope; its status header is asserted against its own checkboxes. |
| [`SPACE-BUNNY-ALPHA-RESEARCH.md`](SPACE-BUNNY-ALPHA-RESEARCH.md) | Empirical evaluation & benchmark record for Space Bunny Alpha (100% pass across 8 task categories). |

## Contracts — code and tests reference these by path, so they do not move

| Doc | Referenced by |
|---|---|
| [`PHASE-21-25-AUDIT.md`](PHASE-21-25-AUDIT.md) | **Protected artifact** — hashed in `scripts/gate-manifest.json`, read by the gate. |
| [`ANVIL-COMPLETE-ROADMAP.md`](ANVIL-COMPLETE-ROADMAP.md) | `docTruth.test.ts` asserts its superseded banner names a live successor. |
| [`STABILIZATION-ROADMAP-2026-09.md`](STABILIZATION-ROADMAP-2026-09.md) | `docTruth.test.ts` asserts its header vs its own checkboxes. |
| [`PHASE-0-VISUAL-REGRESSION-SPEC.md`](PHASE-0-VISUAL-REGRESSION-SPEC.md) | Visual-regression test contract (`__visual__/visual.test.tsx`). |
| [`REWIND-SPEC.md`](REWIND-SPEC.md) | Rewind acceptance contract (`agent/__tests__/rewind.test.ts`). |

## History (completed — read for context, not for instructions)

- **Phases 3–27:** `PHASE-3/4/5/7-NOTES`, `PHASE-8…PHASE-27-{SPEC,PROGRESS,ROADMAP,PLANNING-RECORD}`.
- **UI/UX waves:** `DW-1…DW-4-PROGRESS`, `UI-ROADMAP`, `UI-UX-EVOLUTION-ROADMAP`,
  `UI-CLOSEOUT-RECORD`, `UI-ADVANCEMENT-AUDIT`, `TRUST-UI-RECORD`, `PRODUCT-POLISH-RECORD`,
  `U10-RECORD`, `U12-U13-RECORD`, `SHOWCASE-AUDIT-2026-09-08`.
- **Audits and reviews:** `AUDIT-2026-09-06`, `AUDIT-2026-09-14`, `CODE-REVIEW-RECORD`,
  `REFINEMENT-RECORD-2026-09-09`.
- **Hardening and maintenance:** `P0-RECORD`, `P1-RECORD`, `P2-RECORD`, `P3-RECORD`,
  `HARDENING-RECORD`, `MAINTENANCE-RECORD`, `REWIND-RECORD`, `ROADMAP`.

## Why history is not physically archived yet

A `docs/archive/` move is **deferred deliberately**, not overlooked. The reference map a
future move must satisfy, all verified 2026-09-26:

1. `PHASE-21-25-AUDIT.md` is a **protected artifact** — the gate hashes it and refuses local
   changes without `--ack-protected-change` plus human review. It must not move.
2. `docTruth.test.ts` reads two doc paths by string; a move must update them **in the same
   change** or the suite fails.
3. `rewind.test.ts` and `__visual__/visual.test.tsx` name their contract docs in comments.
4. `AGENTS.md` and `README.md` link into this folder.

When that move is done, keep this index in sync with it — the index is the value; the
directory layout is cosmetic.

## Maintenance

Add new phase specs and progress docs here and add one line to the table above. Do not add a
new index or a second source of truth — the previous ones (several roadmaps claiming to be
"the single source of truth") are exactly what this page replaces.
