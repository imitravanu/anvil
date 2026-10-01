# Phase 39 — Audit remediation: make the record honest

> **Version:** v1.12.x
> **Date:** 2026-09-30
> **Author:** Chief Engineer (OpenCode session, owner-approved)
> **Status:** IN PROGRESS — W1–W2 landed; W3–W8 open.
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

## W2 — Trust exits and consent (COMPLETE, 2026-10-01)

Owner-directed wave; both flagged owner decisions were taken here (the exit
contract now; the parser one stays with W4):

| Finding | Fix | Pinned by |
|---|---|---|
| G4 [P1] | New named `EXIT_PERMISSION_DENIED = 4` (following `EXIT_UNVERIFIED = 3`): headless tracks denials in a pure `DenialTracker`; a run ending with a denial that no executed mutation cleared returns 4, not 0. Decision recorded: a distinct code, because CI must tell "blocked" from "broke" (1) and from "unverified" (3). | `headless.test.ts` (refusal → 4; read-only success after denial → 4; tracker unit pair) |
| C2 [P1] | `isSatisfiedVerdict` accepts ANY separator before the hedge word — the engine's own prompted "YES — however …" form is a NO again. `phase22.test.ts` now imports the predicate instead of re-implementing it. | `goalEngine.test.ts`, `phase22.test.ts` |
| C3 [P2] | Cancellation survives into the result: all four cancel paths set `cancelled: true`; the CLI maps cancelled → `EXIT_CANCELLED` (130) on both `goal_completed` and `goal_failed`. | `goalEngine.test.ts` (critique-cancel mission), `terminalRenderer.test.ts` |
| C4 [P2] | A crash is not a cancellation: the subagent runner sets only `failureReason`; `delegate_task` surfaces the real reason and records `outcome: "error"` (mirrors the team adapter). | `subagentProgress.test.ts` (reason lands in history; no cancelled event) |
| C7 [P2] | `autoCommitMilestone` commits with an explicit pathspec — an unrelated pre-staged user change no longer rides into the milestone commit. | `gitUtils.test.ts` (pre-staged fixture stays staged) |
| F1 [P2] | Consent summaries sanitized at the broker handoff; LSP diagnostics sanitized at render. | `broker.test.ts`, `calls.test.tsx` |
| F2 [P2] | InputBar routes every chunk through `sanitizeTerminalText` (CR/CRLF pre-normalized so overwrite semantics never eat input) — tabs/BEL/FF/ANSI cannot reach the value. | `input.test.tsx` |

**Mutation receipt:** before the fix, **17 new assertions failed across 9 test
files** (core 8 / cli 6 / tui 3), each naming its finding; after, the same
suites pass and the full guardian gate is green — Steps 0–5, **1,360 tests**
(131 cli / 895 core / 334 tui), 25/25 mock evals.

## W3–W8 (open, per AUDIT §11)

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

**Owner decisions, not mechanical edits:** homegrown-parser vs tree-sitter
after W4 stands. The headless-denial exit contract was DECIDED in W2: a
dedicated `EXIT_PERMISSION_DENIED = 4`, not a reuse of `1`.
