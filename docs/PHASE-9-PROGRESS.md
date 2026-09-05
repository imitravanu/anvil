# PHASE 9 — IMPLEMENTATION PROGRESS & REVIEW RECORD

> Phase 9 core (delegation substrate) shipped in commit `6290e6e`. This record
> was written retrospectively on 2026-09-05 from the working tree + test suite
> (the phase shipped with a SPEC but no PROGRESS file). Status below is
> verified against source, not against anyone's report.

## 1. VERIFICATION SNAPSHOT (regression gate, run on current tree)

| Gate | Result |
|---|---|
| `npm run typecheck` (core+tui+cli) | ✅ 0 errors |
| `npm test -w @anvil/core` | ✅ 130/130 (incl. 7 phase9 tests) |
| `npm test -w @anvil/tui` | ✅ 20/20 |
| `npm run build` (incl. esbuild bundle) | ✅ succeeds |

## 2. ACCEPTANCE SCORECARD (vs `docs/PHASE-9-SPEC.md` §3)

| # | Criterion | Status | Evidence |
|---|---|---|---|
| P9-1 | Delegation round-trip: report as tool_result, started+finished emitted, main+sub+main-final call count | ✅ PASS | `agent/__tests__/phase9.test.ts` round-trip test; `agent/session.ts:401-437` intercept; `agent/subagent.ts:44-110` runner |
| P9-2 | Depth guard: sub-agent's delegate_task refused, no nested run | ✅ PASS | `session.ts:374-382` (`allowDelegation: false` is the real guard); `subagent.ts:28-30` filtered tool list; test P9-2 |
| P9-3 | 4th delegation in one turn refused with "Delegation limit" | ✅ PASS | `MAX_DELEGATIONS_PER_TURN = 3` (`subagent.ts:17`); test P9-3 |
| P9-4 | `capReport` truncates >8000 chars with marker (pure unit) | ✅ PASS | `subagent.ts:32-35` (`SUB_AGENT_REPORT_MAX_CHARS = 8000`); test P9-4 |
| P9-5 | Abort propagation: cancel during sub-run → `cancelled`, no `subagent_finished` | ✅ PASS | `subagent.ts:67-71` pre-abort + listener; `session.ts:413-417`; test P9-5 |
| P9-6 | `subAgentTools()` excludes `delegate_task` (pure unit) | ✅ PASS | `subagent.ts:28-30`; test P9-6 |
| P9-7 | Full regression green | ✅ PASS | §1 snapshot |

TUI passthrough (SPEC §4): `tui/src/hooks/useAgentController.ts:202-217`
surfaces `subagent_started` / `subagent_finished` as system notices and folds
sub-agent tokens into StatusBar totals. Minimal by design.

## 3. REMAINING (not Phase 9 core — tracked in `docs/UI-ROADMAP.md`)

- **U10 Sub-agent UI** — collapsed live progress for delegated tasks,
  expandable final reports, per-sub-agent token counters. The substrate events
  exist; the rich presentation does not.
- No persisted sub-agent sessions (spec non-goal, stays out).

## 4. EMPIRICAL NOTES FOR FUTURE AGENTS

1. Sub-agent usage is intentionally NOT yielded as a `usage` event — it would
   pollute the main-turn compaction estimate, which measures MAIN-context
   pressure. Only the capped report (≤8000 chars) enters main history, and
   that IS captured by subsequent main `usage` events. Cost visibility flows
   separately via `subagent_finished` → StatusBar totals. Do not "fix" this
   without re-reading the compaction path (`agent/compaction.ts`,
   `agent/session.ts:199-213`).
2. Both main and sub are `AgentSession`, so interception is name-based and the
   `allowDelegation: false` flag (not the filtered tool list) is the real
   depth guard against a misbehaving model.
3. Sub text deltas accumulate ACROSS its turns; the report is the
   concatenation, then `capReport`-truncated. Structure of sub tool results is
   intentionally not preserved — U10 may revisit.
