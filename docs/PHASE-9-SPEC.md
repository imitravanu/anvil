# Phase 9 Spec — SUB-AGENTS / DELEGATION ("repo-scale research without context flood")

> Status: APPROVED (client directive "9"). Built on the Phase 8 durable loop.
> The implementing agent must follow this spec exactly.

## 0. Objective

Let the main agent delegate a self-contained sub-task to a **sub-agent** (same
provider/model, fresh context, its own budget) and receive a **final report**
as the tool result — so repo-scale exploration no longer floods the main
conversation.

## 1. Design (decided)

- **`delegate_task` tool** — non-mutating delegation call,
  schema `{task: string}`. Intercepted by `AgentSession` (like `update_plan`)
  and executed inline (never inside a parallel read batch).
- **Sub-agent = a real `AgentSession`** with:
  - same provider + model + projectRoot,
  - dedicated `SUB_AGENT_SYSTEM_PROMPT` (investigate, don't ask, end with a report),
  - fresh history, own iteration budget (`SUB_AGENT_MAX_ITERATIONS = 12`),
  - **tools = `TOOL_DEFINITIONS` minus `delegate_task`** (depth limit 1),
  - **the SAME permission broker instance** (shared "always allow" grants;
    mutating sub-agent actions still prompt the user).
- **Budgets & caps** (constants, recorded): depth 1; 3 delegations per user
  turn (`MAX_DELEGATIONS_PER_TURN`); report cap 8000 chars (`capReport`).
  NO wall-clock timer (the shared AbortSignal covers user cancel) — decision.
- **New option** `AgentOptions.tools?: ToolDefinition[]` (session uses it over
  the global list; also the seam MCP will need) and
  `AgentOptions.allowDelegation?: boolean` (default true; sub-agents run with
  false so a misbehaving model cannot nest).
- **New events**: `subagent_started {task}`, `subagent_finished
  {toolCalls, inputTokens, outputTokens}`. Sub-agent usage is NOT yielded as a
  `usage` event (it would pollute the compaction estimate) — the TUI adds it to
  its totals from `subagent_finished`. Ledger entries: `subagent_started`,
  `subagent_finished` (with measured tokens).

## 2. Non-goals

- NO nested delegation (depth 1 only). NO parallel delegations (serial, declared
  order). NO wall-clock timeout. NO sub-agent streaming into the main transcript
  (only start/finish notices). NO persisted sub-agent sessions.

## 3. Acceptance (FakeProvider, deterministic)

- P9-1 delegation round-trip: main turn calls delegate_task → sub run executes →
  report returned as tool_result; `subagent_started`+`subagent_finished` emitted;
  provider call count = main + sub + main-final.
- P9-2 depth guard: a sub-agent whose script calls delegate_task gets an error
  tool_result, no nested run (single `subagent_finished`).
- P9-3 limit: 4th delegation in one turn refused with "Delegation limit".
- P9-4 `capReport` truncates >8000 chars with a marker (pure unit).
- P9-5 abort propagation: session.cancel() during a sub run → `cancelled`
  event, no `subagent_finished`.
- P9-6 `subAgentTools()` excludes `delegate_task` (pure unit).
- P9-7 full regression: all existing tests still green.

## 4. Sequencing

types → `tools/delegateTask.ts` → `agent/subagent.ts` → session intercept →
TUI passthrough → tests → gates. Rebuild core dist before tui/cli typecheck
(gotcha #1 in PHASE-8-PROGRESS).

## 5. Gotchas

- The interception is name-based inside `AgentSession.send` — BOTH main and sub
  are AgentSessions, so the `allowDelegation: false` flag is the real depth
  guard (the filtered tool list only stops a well-behaved model).
- Sub text deltas accumulate ACROSS its turns; the report is the concatenation.
- `delegate_task` results are returned as `{report}` JSON in the tool_result.
