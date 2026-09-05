# U10 RECORD — sub-agent cards + ToolDefinition unification (2026-09-05)

> Status: IMPLEMENTED + VERIFIED (gates in §4). Single source of truth for
> this slice. Closes U10 (`docs/UI-ROADMAP.md`) and the FINDING-2 cleanup
> tracked in `docs/PHASE-10-PROGRESS.md` §5.

## 1. PROBLEM (verified gap, not a roadmap whim)

Delegation shipped in Phase 9, but the transcript never showed sub-agent
FINDINGS: `subagent_started/finished` printed bare system notices (task +
counts) while the report itself went only to the model as a tool_result.
The user paid tokens for research they could never read. U10 fixes exactly
that.

## 2. CHANGES (exact file list)

```
U10 cards:
  packages/core/src/agent/types.ts                 # subagent_finished += report
  packages/core/src/agent/session.ts               # yield report (already capped)
  packages/core/src/agent/__tests__/phase9.test.ts # P9-1 shape updated + U10 cap test
  packages/tui/src/util/subagent.ts                # NEW: retain/format/cap helpers (pure)
  packages/tui/src/util/__tests__/subagent.test.ts # NEW: +4 tests
  packages/tui/src/components/SubAgentView.tsx     # NEW: card (collapsed + /expand report)
  packages/tui/src/hooks/useAgentController.ts     # DisplayMessage.subAgents; cards replace notices; cancelled marks cards
  packages/tui/src/components/MessageView.tsx      # render cards, forward expandTools
  packages/tui/src/components/App.tsx              # seedFromHistory gains subAgents: []
  docs/UI-ROADMAP.md                               # U10 marked done
Cleanup (FINDING-2):
  packages/core/src/providers/types.ts             # delete duplicate interface; re-export tools flavor
  packages/cli/src/index.tsx                       # plain ToolDefinition annotation again (workaround removed)
NEW DOC:
  docs/U10-RECORD.md                               # this file
```

## 3. DESIGN DETAILS

### 3.1 Report carriage
- `subagent_finished` carries `report: run.report` — already capped at
  8000 chars by `capReport` (P9-4), so no new truncation point in core.
- P9-1's exact `toEqual` updated to the new shape (intended, recorded
  here); new U10 test proves an over-long report arrives capped with the
  truncation marker. P9-5 (cancel → no finished event) untouched and green.

### 3.2 Cards (replacing notices, not adding to them)
- `subagent_started` appends a `running` card to the ASSISTANT turn (that
  appearance IS the live progress — no separate notice anymore).
- `subagent_finished` fills the oldest running card (counts + retained
  report) and folds tokens into StatusBar totals exactly as before.
- `cancelled` marks stranded running cards `cancelled` (new case; the
  streaming/isBusy flip behavior is unchanged).
- Displayed collapsed line always (`◈ sub-agent: <task> — …`); report body
  (30 lines + omission) only under the existing global `/expand` — no new
  toggles, consistent with U6. Reports retained at 4000 chars with an
  honesty marker (full version stays in history for the model).
- Resume seeds `subAgents: []` — past sub-agent cards don't replay (same
  policy as tool calls; text history replays, activity chrome doesn't).

### 3.3 ToolDefinition unification (FINDING-2 closed)
- Deleted the 3-field duplicate in `providers/types.ts`; it now re-exports
  the tools flavor. Verified safe before cutting: every construction site
  already carries `mutating`; providers/adapters only read
  name/description/inputSchema (superset flows through structurally);
  `tools/types.ts` is import-free so no cycle.
- CLI drops the `typeof TOOL_DEFINITIONS` workaround for the plain
  annotation — the stale-warning comment is gone with the landmine.

## 4. VERIFICATION

```bash
cd /home/mitravanu/Projects/anvil
npm run build -w @anvil/core
npm run typecheck               # 0 errors, all 3 packages
npm test -w @anvil/core         # 158/158 across 25 files (was 157)
npm test -w @anvil/tui          # 47/47 across 10 files (was 43/9)
npm run build                   # esbuild bundle OK
git status --porcelain           # only §2 files (+ prior slices' files)
```

Result on 2026-09-05: ALL GREEN.

## 5. REMAINING BOARD (everything else on it is done)

- U12 component-test infra, U13 custom themes. Suggested next: U12 — every
  UI slice since Phase 8 has noted component refactors are risky without
  it, and the component surface just grew again (SubAgentView).
