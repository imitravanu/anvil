# Phase 8 Spec — THE TRUTHFUL ENGINE + LIVE FREE-MODEL RADAR

> Two workstreams, one principle: **Anvil never lies about its own state.**
> Status: APPROVED (by delegation). The implementing agent must follow this spec
> exactly — no improvisation, no reordering, no trimming of acceptance criteria.

## 0. Product context

- Client mandate (REQUIREMENT): *free models = find them, catch them, sync them,
  always updated* is a **co-core pillar**, not a side feature.
- Architect decision (DECISION): free-model truthfulness and loop accountability are
  the same engineering idea -> one phase, two workstreams, one regression gate.
- Non-copy moat (DECISION): differentiation = *accountability*. Anvil records what it
  did and reports the truth of its own state (budgets, freshness, health) rather than
  copying competitor surface features.

## 1. Objective

Make `AgentSession`'s loop **bounded, loop-safe, ordered, auditable, growth-bounded** and
make free-model availability **measured, fresh, single-owned, never silently stale** —
both proven by automated tests, never by the implementer's word.

## 2. Non-goals (enforce regardless of temptation)

- NO MCP, NO sub-agents.
- NO provider 429 retry/backoff (only *record* 429s).
- NO predictive token-counting engine (only *record* measured usage).
- NO new TUI test infra in this phase; TUI is a thin pass-through consumer only.
- NO new free-model *sources* beyond OpenRouter — the source *interface* is built so
  sources can be added by a later phase, but this phase ships OpenRouter as the sole source.

---

## 3. Workstream A — THE DURABLE LOOP

### A.1 Scope

1. **Iteration budget.** `AgentOptions.maxInnerIterations?: number`, default **20**. Counts
   inner-loop passes that execute >= 1 tool call. On exhaustion: emit
   `{type: "budget_exhausted"}` AgentEvent, append ONE final system-role message into
   history — "I reached this turn's step limit (20). Here is where I am and what remains;
   tell me to continue." — then terminate the turn cleanly. NEVER truncate silently,
   NEVER keep running.
2. **Loop detection.** Per-`send()`-turn tracker keyed by `tool + canonicalInputHash(input)`.
   Canonical hash = `JSON.stringify` with **object keys sorted recursively** (never raw
   stringify — provider argument order is unstable). On the 3rd *consecutive* identical
   key: emit `{type: "loop_detected", tool}` once and append a system message demanding
   a different approach. A 4th identical call in the same turn is **REFUSED**: the
   tool_result is "Repeated identical call blocked by loop guard" and the tool is NOT
   executed.
3. **Declared parallel-execution policy.**
   - Batch contains ANY `mutating` tool -> execute the whole batch **serially** in
     declared call order (permission prompt stays single-flight; no file/command races).
   - Batch all read-only (`!def.mutating`) -> execute **concurrently** (`Promise.all`,
     shared abort controller), then emit all `tool_result` content **in declared call
     order** — provider replay stability (existing constraint F5) is non-negotiable.
4. **Plan scratchpad.** New NON-mutating tool `update_plan`, inputSchema
   `{type:"object", properties:{plan:{type:"string"}}, required:["plan"]}`, description
   "Record your current plan and next steps. The plan is shown to the user. Call when
   starting, when a step fails, or when the plan changes. Be concise." Effects: set
   `AgentSession.plan`, emit `{type:"plan_updated", plan}`, tool_result `{ok:true}`.
   Persisted in `StoredSession.metadata.plan`; rehydrated on restore and re-emitted once.
5. **Run ledger.** Append-only, capped (<= 1000 entries, drop oldest). Entry shape:
   `{seq, ts, eventType, tool?, inputHash?, outcome: "ok"|"error"|"denied"|"aborted",
   tokens?: {in, out}, elapsedMs}`. Written on: tool_started, tool_finished,
   tool_permission_denied, budget_exhausted, loop_detected, aborted.
   `AgentSession.getRunLedger(): readonly RunLedgerEntry[]`. Serialized into
   `StoredSession.metadata.runLedger` (same cap).

### A.2 Contract changes (exact)

```ts
// agent/types.ts
export type AgentEvent =
  | ...existing
  | { type: "budget_exhausted" }
  | { type: "loop_detected"; tool: string }
  | { type: "plan_updated"; plan: string };

export interface AgentOptions {
  ...existing;
  maxInnerIterations?: number; // default 20
}

export interface RunLedgerEntry {
  seq: number; ts: string; eventType: string;
  tool?: string; inputHash?: string;
  outcome: "ok" | "error" | "denied" | "aborted";
  tokens?: { in: number; out: number }; elapsedMs: number;
}

// agent/session.ts
export class AgentSession {
  plan: string | null;                 // set by update_plan
  getRunLedger(): readonly RunLedgerEntry[];
}

// session/types.ts (StoredSession.metadata additions)
plan?: string;
runLedger?: RunLedgerEntry[];
```

### A.3 Acceptance (FakeProvider, deterministic, no network)

- **A1** FakeProvider returns 5 read-only calls in one turn -> all 5 execute concurrently
  (executor records staggered resolve), `tool_result` entries in declared order.
- **A2** FakeProvider returns a mixed batch (reads + a write) -> fully serial, declared
  order, `tool_started` event order matches.
- **A3** FakeProvider drives 21+ tool iterations -> exactly one `budget_exhausted`, loop
  ends, final history contains the "step limit" system message, no further provider call.
- **A4** FakeProvider repeats identical (tool, input) 3x -> `loop_detected` once; a 4th
  call refused (side-effect counter == 3).
- **A5** `update_plan` -> `plan_updated` emitted, `session.plan` set, stored-session
  round-trip preserves `plan`, restore re-emits `plan_updated`.
- **A6** Ledger populated per iteration; serialize/deserialize round-trip; cap holds at
  >= 1000.
- **A7** **All existing 97 tests still pass.**

---

## 4. Workstream B — LIVE FREE-MODEL TRUTH

### B.1 Verified current weaknesses (from Phase 7 source)

- W1 `syncOpenRouterModels` swallows every error -> staleness is **invisible**.
- W2 Three independent triggers (CLI boot, ModelPicker mount, `/sync`) -> double-sync
  race; no single owner.
- W3 No freshness clock / TTL -> the cache can be arbitrarily old with no marker.
- W4 OpenRouter-only; no source abstraction.
- W5 No health/429 tracking -> a rate-limited "free" model still shows `[FREE]`.

### B.2 Scope

1. **`FreeModelSource` interface** (new `providers/freeModels.ts`):
   `{ id: string; fetchFreeModels(apiKey?): Promise<ModelInfo[]> }`. OpenRouter source =
   thin wrapper over the existing `fetchOpenRouterFreeModels`.
2. **Sync coordinator `syncFreeModels(opts)`** — the SINGLE owner. Behaviors:
   - **Single-flight**: concurrent calls return the same in-flight promise.
   - **TTL** (default 10 min): a refresh within the TTL is a no-op.
   - **Error classification** in the report — `{refreshedAt?, results: [{sourceId, ok,
     count, newlyFree[], noLongerFree[], error?}], errors: []}`. NEVER throw; NEVER
     silently discard an error — every failure lands in the report.
   - On success: `registerModels(...)` then persist cache **v2**.
3. **Cache v2** (cache.ts): shape `{version: 2, syncedAt: ISO, sources: {[sourceId]:
   ModelInfo[]}}`. Backward-compatible: read legacy v1 array and migrate. Helper
   `isModelsCacheFresh(ttlMs): boolean`.
4. **Surfacing** (TUI pass-through, minimal):
   - ModelPicker: when the cache is stale or the last sync failed, one dimmed line —
     "free model list is N min old / sync failing — free prices may be out of date".
   - 429 recording: coordinator `noteRateLimited(sourceId, modelId)` maintains an
     in-memory health list; picker shows `[rate-limited]` for affected models. No
     backoff yet (non-goal).
   - `/sync` prints the full report (counts AND errors), not just "done".

### B.3 Contract changes (exact)

```ts
// providers/freeModels.ts (NEW)
export interface FreeModelSource {
  id: string;
  // AMENDMENT (P2, 2026-09-05): shipped as `fetchFreeModels` — same shape.
  fetchFreeModels(apiKey?: string): Promise<ModelInfo[]>;
}
export interface SourceResult {
  sourceId: string; ok: boolean; count: number;
  newlyFree: string[]; noLongerFree: string[]; error?: string;
}
export interface SyncReport {
  refreshedAt: string | null; results: SourceResult[]; errors: string[];
}
export function createOpenRouterFreeSource(): FreeModelSource;
export function syncFreeModels(opts: {
  sources: FreeModelSource[];
  apiKeyBySource?: Record<string, string | undefined>;
  ttlMs?: number;
}): Promise<SyncReport>;

// cache.ts additions
export function isModelsCacheFresh(ttlMs: number): boolean;
```

Replace the three existing `syncOpenRouterModels` call sites (CLI boot, Picker mount,
`/sync` command) with the coordinator — registry mutation now passes through ONE gate.
`syncOpenRouterModels` may remain as a thin wrapper or be removed; the coordinator is
authoritative.

### B.4 Acceptance (FakeFreeModelSource, deterministic)

- **B1** Two concurrent `syncFreeModels()` calls with the same source -> source fetch
  runs ONCE (proven by call counter).
- **B2** Within TTL, a 3rd call -> no fetch.
- **B3** Source throws -> report contains `{ok:false, error}`, does NOT throw, registry
  and cache are UNCHANGED (no partial state).
- **B4** Source returns a new free model not in the registry -> registered and counted in
  `newlyFree`; a model no longer free -> demoted and in `noLongerFree`.
- **B5** Cache v2 written with `syncedAt`; legacy v1 file migrates; `isModelsCacheFresh`
  correct for fresh and stale.
- **B6** Staleness helper is unit-tested; picker stale notice is a thin boolean.

---

## 5. Global regression gate & verification

```bash
npm test -w @anvil/core    # A1-A7, B1-B5, plus existing 97
npm run typecheck           # strict, all packages
npm run build              # esbuild bundle includes new modules
```

Pass = acceptance criteria all green AND `git diff --stat` shows no file changed outside
this spec's scope.

## 6. Sequencing constraints (do not reorder)

1. Core types (`AgentEvent`/`AgentOptions`/`RunLedgerEntry`) -> 2. Session budget + loop
   detection -> 3. Parallel execution with result re-order -> 4. `update_plan` + plan
   persistence -> 5. Ledger -> 6. Workstream B (interface -> coordinator -> cache v2 ->
   call-site migration -> surfacing) -> 7. Tests written WHILE building, not after ->
   8. Regression gate.

## 7. Known gotchas (from verified source)

- Parallel results MUST be re-ordered before `history.push` — provider replay (F5)
  depends on it.
- One shared `AbortController` — all concurrent reads must observe it (F8).
- Canonical hash = recursive sorted-keys stringify; providers do not emit stable arg order.
- `update_plan` is non-mutating -> must NOT enter the permission prompt path.
- Ledger and plan caps bound session-file growth.
- `openrouter/free` contextWindow placeholder (200k) is UNTOUCHED this phase — compaction
  stays reactive; the ledger records real usage for a later phase to consume.

## 8. Risks & rollback

- Parallel reads change timing, not content — accepted; order contract is the invariant.
- Default limit of 20 may feel tight on huge refactors — configurable; the exhaustion
  event explains the position.
- Free-model TTL (10 min) can miss a just-flipped price — `/sync` forces refresh and
  `[rate-limited]` marks temporarily unavailable models.
- Rollback: a single revertible commit; `maxInnerIterations` is option-gated (unset =
  legacy behavior); the coordinator degrades to a single fetch with no side effects.

## 9. DECISION LOG (approved)

| Decision | Alternatives rejected | Reason | Trade-off |
|---|---|---|---|
| Two workstreams, one phase | loop-only; free-only; split releases | both cores share one principle; disjoint modules | larger PR — mitigated by per-workstream acceptance |
| Read-parallel, mutating-serial | all-parallel; all-serial | safety + single-flight permission prompt | less per-turn speed than full parallel |
| Default 20 iterations | 5 (too tight); unlimited (status quo) | long tasks provably complete | configurable by user |
| Canonical hash sorts keys recursively | raw JSON.stringify | provider arg order unstable | small CPU cost |
| Source interface now, OpenRouter-only ship | skip interface | "always updated" needs future sources | minimal, justified abstraction |

## 10. Definition of done

1. All A/B acceptance tests exist in `packages/core/src/**` and pass.
2. Regression gate green (tests + typecheck + build).
3. Working-tree diff limited to spec scope.
4. TUI changes only the two thin surfacing points (plan line, stale/rate-limited marks)
   plus `/sync` report rendering.
5. Section 9 decisions not silently altered.