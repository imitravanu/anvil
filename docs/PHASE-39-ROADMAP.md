# Phase 39 — Audit remediation: make the record honest

> **Version:** v1.12.x
> **Date:** 2026-09-30
> **Author:** Chief Engineer (OpenCode session, owner-approved)
> **Status:** IN PROGRESS — W1 landed 2026-09-30; W2–W8 open.
> **Scope:** [`AUDIT-2026-09-30.md`](AUDIT-2026-09-30.md) recorded 79 findings
> (9 × P1, 29 × P2, 41 × P3) from a full-tree adversarial review and grouped
> them into eight workstreams (its §11). This phase executes them. Every wave
> keeps the full guardian gate green and commits per workstream, here.

## Sequencing

**W1 had to land before Phase 38.5** (the prompt rewrite): a rewrite gated by a
harness that still miscounted budgets (A1) and winners (A2) would repeat Phase
38's founding error. W1 landed 2026-09-30, so **38.5 is unblocked**. W2–W8 are
independent of 38.5.

## W1 — Measurement integrity (COMPLETE, 2026-09-30)

Closes the 38.4 harness's own defects plus the certification default:

| Finding | Fix | Pinned by |
|---|---|---|
| A1 [P1] | `armProfileOverride()` floors only an EXPLICIT arm budget; an unset budget passes the task's own budget through. Before: every A/B run was forced to 4,096 tokens while shipping runs at 8,192 | `experiment.test.ts` (A1 pair), observed end-to-end in `profileSeam.test.ts` |
| A2 [P1] | `assessSignificance` records each reproducible task's winner; a 5-task split (3 baseline / 2 candidate) is reported as a split, not as "unanimous" for the aggregate leader | `significance.test.ts` A2 pair |
| A3 [P2] | `betweenTaskDelayMs` now sleeps between A/B runs; the option was spread into per-task calls whose only consumer is the batch runner | shape mirrors `runAllEvalTasks`; full gate green |
| A5 [P2] | one `matchesTaskFilter` (id OR name, case-insensitive) shared by both eval lanes | `experiment.test.ts` A5 |
| A6 [P2] | NEW `profileSeam.test.ts` mocks `AgentSession` and asserts the RESOLVED session options (budget + prompt), replacing a test that accepted any throw | 4 seam tests |
| B1 [P1] | certification provenance is fail-closed: an omitted `mock` flag records "mock"; only an explicit `mock: false` records "live" (the suite had stamped real registry rows live) | `certify.test.ts` provenance pair |
| G14 [P3] | `hasOwnProperty` guard: `ANVIL_LOG=constructor` can no longer shadow the level map | `logger.test.ts` |

**Mutation receipt:** with the four production files stashed, **10 of 10 new
assertions failed**, each naming its finding (A1 ×3, A2 ×2, A5, A6, B1, G14);
10/10 pass after restore, and the full guardian gate (Steps 0–5, all unit
suites, 25/25 mock evals) is green on the final tree.

**38.4 doc closure (part of G5):** the phase table, section header, status,
CURRENT-FOCUS numbering (harness = 38.4, rewrite = 38.5), the CHANGELOG "rerun
in flight" claim and invented verdict quote, and the `agentProfile.ts` comment
numbering are all corrected in this wave. Stale numeric counts elsewhere in the
docs (G6) are scheduled with W8, not rewritten silently here.

**Recorded open item (AUDIT A4):** the harder task tier 38.4's spec requires —
long horizon, multi-turn, real repo — is NOT authored; `evals/ab.ts` still
points at the 25 saturated short tasks. This is a named gap, not an implied
one: authoring it is W1's remaining tail and doubles as 38.5's measurement
carrier.

## W2–W8 (open, per AUDIT §11)

- **W2 — Trust exits and consent:** C2, C3, C4, C7, F1, F2, G4. Headless runs
  must exit non-zero when every mutation was denied (owner decision: new exit
  code vs reuse `1`).
- **W3 — Gate and infra integrity:** G1–G3, G7, G8, G16. **Protected artifacts**
  — needs the AGENTS.md §3.4 path: declared purposes, manifest regen, sentinel
  in sync, explicit human review of the protected-path diff.
- **W4 — Code intelligence:** D1a–f six reproduced parser defects + regression
  fixtures, D2, E10. After it lands, re-assess the CURRENT-FOCUS tree-sitter
  trigger: D1 is already the 4th lexical patch family for Rust/TS.
- **W5 — Safety:** E1, E2, E6, C5, C6, C8 (bash realpath + flag-value parsing,
  root-wipe normalization, memory cap, guardian write-back).
- **W6 — TUI correctness:** F3–F7, F9–F11 (member ids, usage accumulator,
  cell-width, narrow-terminal diff, baselines).
- **W7 — Provider/eval accounting:** B3, B4, B8, A7, A8.
- **W8 — Slop debt + docs truth:** H1, C9–C19, E7–E9, F8/F12/F13, G6–G13, G15,
  G17. Mechanical sweep once the scanners exist (G1/G3 are in W3).

**Owner decisions, not mechanical edits:** the headless-denial exit contract
(W2/G4) and homegrown-parser vs tree-sitter after W4.
