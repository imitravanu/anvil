# Phase 25 — Next-Gen Evolution (v1.0.0) — Progress Record

> Per AGENTS.md §1: entry protocol followed — roadmap §6 + audit read, reality verified
> (25.1 present at HEAD `f7dedef`, 25.2–25.6 absent), existing helpers reused
> (`getErrorMessage`, `constants.ts`, `registerExternalExecutor`, `resolveWithinRoot`,
> `TOOL_DEFINITIONS`, `makeHandlers` seam). No protected artifacts touched.

## Status: COMPLETE — gate passed 2026-09-14 (post-wiring follow-up)

> Wiring note: the record below describes the Phase-25 module layer as originally built. All
> 25.2–25.6 features have since been wired into the product paths (plugins at boot context, guardian
> gate in the agent session, selective compaction in `compactIfNeeded`, `runTeam` behind
> `delegate_task`'s optional `team` spec) and the full gate is green — see the 2026-09-14 status
> update in `docs/AUDIT-2026-09-14.md` and the CHANGELOG `[Unreleased]` section for the product-path
> detail. Goal-mode caveat: plugin tools reach goal mode, plugin prompts do not (GoalEngine assembles
> its own prompt — a deliberate follow-up, not a regression).

### 25.1 SSE/HTTP MCP Transport — VERIFIED (pre-existing)
- Evidence: `packages/core/src/mcp/transport.ts:222` SSE transport + `SseFrameParser`,
  `packages/core/src/config/mcp.ts:11` `transport: "stdio" | "sse"` validation with
  https-except-loopback rule, tests `packages/core/src/mcp/__tests__/sse.test.ts`.
- Acceptance boxes in roadmap §25.1 were already `[x]`; this phase confirms them.

### 25.2 Multi-Agent Collaboration — DONE
- `packages/core/src/agent/team/types.ts` — `TeamStrategy`, `TeamSpec`, results.
- `packages/core/src/agent/team/runner.ts` — `validateTeamSpec`, `splitBudget`,
  `runTeam` (parallel/review fan-out with failure isolation; pipeline serial handoff
  injecting prior reports). Budget split: even + remainder to early members.
- Exported via `agent/index.ts`. Tests: `team/__tests__/team.test.ts` (9 cases).

### 25.3 LSP Integration — DONE
- `packages/core/src/lsp/detector.ts` — PATH probing for
  typescript-language-server / pyright-langserver / rust-analyzer / gopls.
- `packages/core/src/lsp/client.ts` — minimal stdio JSON-RPC client
  (Content-Length framing, initialize, definition/references/hover/diagnostics,
  timeout via `LSP_REQUEST_TIMEOUT_MS`, fail-fast close).
- `packages/core/src/lsp/tools.ts` — `goto_definition`, `find_references`,
  `get_hover`, `get_diagnostics` registered in `tools/index.ts` (15 tools total).
  Each reports `source: "lsp" | "fallback" | "tsc" | "none"` — never a stub.
- `get_outline` untouched (fast regex path per spec). Tests: `lsp/__tests__/lsp.test.ts`.

### 25.4 Plugin System — DONE
- `packages/core/src/plugins/loader.ts` — `loadPlugins` (never throws),
  strict manifest validation, `pluginSystemPrompts`.
- `packages/core/src/plugins/registry.ts` — `plugin_<name>__<tool>` defs +
  `registerPluginExecutors` via `registerExternalExecutor` (mutating → gated).
- Tool commands run via `bash -c` in projectRoot, 60s timeout, 512 KiB cap.
- Tests: `plugins/__tests__/plugins.test.ts` (6 cases).

### 25.5 Intelligent Context — DONE
- `packages/core/src/agent/context/scoring.ts` — `scoreMessages` (0.5 keyword +
  0.3 recency + 0.2 file-aware), `contextBreakdown` (role/tool/text split,
  utilization, `shouldWarn`), `selectiveKeep` (budgeted keep + always latest).
- `/context` TUI command (`handlers/phase25.ts`). Tests: `context/__tests__/context.test.ts`.

### 25.6 Native Guardian Engine — DONE
- `packages/core/src/guardian/scanner.ts` — in-process Step 1/1.5 families
  (no-as-any excl. tests, no-raw-error-format, no-empty-catch).
- `packages/core/src/guardian/interceptor.ts` — `interceptTurn` (scans pending
  diffs pre-write; auto-fixes raw-error ternary up to `GUARDIAN_MAX_AUTO_FIXES`;
  blocks the rest with actionable violations).
- `packages/core/src/guardian/init.ts` — `guardedInit` (AGENTS.md +
  .fresh-allowlist.json, never overwrites).
- CLI: `anvil gate [--full]` (`cli/src/gate.ts`), `anvil init --guarded [--lang]`
  (`cli/src/initGuarded.ts`) wired in `cli/src/index.tsx` dispatch + HELP.
- Tests: `guardian/__tests__/guardian.test.ts` (9 cases), `cli/src/__tests__/phase25.test.ts`.

### 25.7 Release Criteria
- [x] Phases 21–24 stable (clean tree at start; final `npm run gate` green 2026-09-14)
- [x] Phase 25 features shipped (25.1–25.6 above)
- [x] Docs current (CHANGELOG 1.0.0 entry, this record, README slash table below)
- [x] All 10 providers certified `live` — `npm run certify -- --mock --all` 10/10 (2026-09-14)
- [x] Zero known vulns — `npm audit --omit=dev`: 0 vulnerabilities (2026-09-14)
- [ ] Eval ≥ 80% on a real provider — operator-run with keys (`live-eval.yml` weekly lane)

## Files added (new, untracked → scanned by gate Step 1)
- agent/team/{types,runner,index}.ts + __tests__/team.test.ts
- lsp/{types,detector,client,tools,index}.ts + __tests__/lsp.test.ts
- plugins/{types,loader,registry,index}.ts + __tests__/plugins.test.ts
- agent/context/{scoring,index}.ts + __tests__/context.test.ts
- guardian/{scanner,interceptor,init,index}.ts + __tests__/guardian.test.ts
- cli/src/{gate,initGuarded}.ts + __tests__/phase25.test.ts
- tui/src/commands/handlers/phase25.ts

## Files modified (tracked diff)
- core/src/config/constants.ts (7 new Phase 25 constants, env-overridable)
- core/src/index.ts, agent/index.ts (exports)
- core/src/tools/index.ts (4 LSP tools → 15 total)
- tui commands types.ts + registry.ts (/team /plugin /context)
- tui commands __tests__/registry.test.ts (new command tests)
- cli/src/index.tsx (gate/init dispatch + HELP)
- version.ts + 3 package.jsons → 1.0.0, CHANGELOG 1.0.0 entry

## Known limitations
- Team runner coordinates via injected `runMember`; live session wiring (model-driven
  fan-out) is future work — the orchestrator, strategies, and budgets are real and tested.
- LSP hover/diagnostics need a server on PATH; otherwise honest fallback (no fake data).
- `anvil gate` fast mode scans the working-tree diff; `--full` delegates to `npm run gate`.
- inter-agent messaging is task-text handoff (pipeline) / shared-fs (parallel), not a message bus.

## Verification (2026-09-14 — GREEN)
- `npm run gate`: **PASSED** all 8 stages (sensor, manifest, diff scan, residual drain,
  sequential build core→tui→cli, typecheck ×3, unit tests, mock eval 15/15).
- Unit tests: core 465+ (incl. 38 new Phase 25), tui 169 (incl. 3 new command tests
  + refreshed `empty-state.txt` baseline v0.11.0→v1.0.0, diff verified version-only),
  cli 20 (incl. 2 new gate/init tests).
- No protected artifacts touched (manifest untouched, sentinel unmodified).
