# P3 RECORD — structural splits (2026-09-05)

> Status: IMPLEMENTED + VERIFIED (gates in §4). The two God modules
> (`AgentSession.send()`, `App.tsx`) are decomposed with zero behavior
> change — the full pre-existing suites pass unmodified, which IS the proof.
> Designs were produced by parallel agents against exact line ranges and
> executed verbatim, with deviations noted in §3.

## 1. CORE — send() decomposition

New modules (`packages/core/src/agent/`):
- `turnState.ts` — per-turn mutable state (iterations, delegations,
  streak/latch/counts, compaction flag) with `checkBudget`,
  `markIteration`, `markCompactionAttempted`, `tryConsumeDelegation`
  (increment-before-await preserved), `observeKey` (streak + totals +
  warn/refuse verdicts).
- `loopGuard.ts` — `AccumulatedToolCall` (moved), `PreparedCall`,
  `classify` (declared order, def lookup, canonical keys),
  `warnText` (both literals verbatim), `refusedResult`.
- `orchestrator.ts` — `RunnableCall`, `ToolOrchestrator` (serial vs
  concurrent incl. `?? true` unknown policy, permission-cancel race,
  unknown-tool path, ledger timing from borrowed `startedAt`).
- `historyStore.ts` — sole history writer (user text, budget notice,
  assistant guard, compaction merge, declared-order tool results with
  leading turn notes).

`session.ts` keeps: lifecycle (AbortController, isSending, checkpoints,
ledger, plan, provider/options), stream accumulation, intercepts
(update_plan/delegate_task/refused ordering), rewind snapshot point,
sub-agent runs, merge + close. Net: ~748 → ~566 lines; the execution
branches (~110 lines) deleted, not moved-and-kept.

Deviations from the design agents' plan: none material. (`HistoryStore`
gained `length`/`replaceAll` conveniences beyond the draft; `refusedResult`
helper added for the refusal copy.)

## 2. TUI — App decomposition

- `hooks/useThemeManager.ts` — theme state, custom-theme merge, resolve,
  apply (byte-identical logic incl. per-invocation reload).
- `hooks/useSessionCommands.ts` — persist, resumeFromStored (+
  seedFromHistory moved with it), handleSubmit.
- `commands/registry.ts: makeHandlers(deps)` — the ONE `CommandContext`
  constructor; new commands touch registry + types only.
- `commands/types.ts: CommandHandlerDeps` — the full deps surface.
- `App.tsx` — composition only: state topology, overlay router,
  model/session/connect pick handlers, frame. (~456 → ~290 lines.)

Deviations: `replaceMessages` stays out of the factory (only
`resumeFromStored` needs it, injected); `McpAppState` stays exported from
App (type-only cycle, erased at compile).

## 3. VERIFICATION

```bash
npm run build -w @anvil/core && npm run build -w @anvil/tui
npm run typecheck               # 0 errors, all 3 packages
npm test -w @anvil/core         # 205/205 across 29 files — ZERO test changes
npm test -w @anvil/tui          # 85/85 across 17 files — ZERO test changes
npm run build                   # esbuild bundle OK
```

Result: ALL GREEN. Catches during the slice (fixed before green): compaction
call-site still passing the live array, missing `McpAppState`/`loadSession`
imports after the cut, `setCustomThemes` setter wiring, `ToolDefinition`
import flavor in the CLI (pre-existing duplicate interface — since unified
in U10 slice).

## 4. PROJECT STATE

P0, P1, P2, P3 all complete. Roadmap (phases 0–10, U1–U13) was already done;
the review record is now worked through P3. Remaining: standing design
partials (side-by-side diffs, per-tool expand, auto-summary, picker/overlay
interaction tests, remote MCP, CJK widths) + P2-deferred research items
(registry windows, EACCES policy, frame widths). Suggested posture unchanged:
use it, fix what bites, commit the stack (P0–P3 uncommitted).
