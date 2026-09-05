# PHASE 10 — IMPLEMENTATION PROGRESS & REVIEW RECORD

> Spec `docs/PHASE-10-SPEC.md` (APPROVED client directive "do it",
> 2026-09-05). Status below is verified against the working tree + test
> suite, not against anyone's report.

## 1. VERIFICATION SNAPSHOT (regression gate, run on current tree)

| Gate | Result |
|---|---|
| `npm run typecheck` (core+tui+cli) | ✅ 0 errors |
| `npm test -w @anvil/core` | ✅ 157/157 across 25 files (was 138/21) |
| `npm test -w @anvil/tui` | ✅ 43/43 across 9 files (was 41/8) |
| `npm run build` (incl. esbuild bundle) | ✅ succeeds |
| `git status --porcelain` | ✅ only §2 files |

## 2. ACCEPTANCE SCORECARD (vs SPEC §4)

| # | Criterion | Result | Evidence |
|---|---|---|---|
| M1 | Fake transport, 2 tools → namespaced defs reach provider with schema | ✅ PASS | `mcp/__tests__/client.test.ts` handshake test + `agent/__tests__/phase10.test.ts` M1 (`calls[0].tools` carries `mcp_srv__lookup` + schema) |
| M2 | Round-trip → content as non-error tool_result + ledger | ✅ PASS | phase10 M2; ledger `tool_finished/mcp_srv__lookup` |
| M3 | Mutating MCP tool forces batch serial | ✅ PASS | phase10 M3 (`start:read_file/done:read_file/start:mcp…/done:mcp…`) |
| M4 | Dead-server tool errors cleanly; unknown names still error | ✅ PASS | phase10 M4 (error conn → isError "connection lost"; `executeTool("definitely_not_a_tool")` → unknown-tool error) + client JSON-RPC-error test |
| M5 | Name collision drops MCP tool, built-in wins | ✅ PASS | `tools/__tests__/mcpTools.test.ts` (evil twin + dupe dropped) |
| M6 | Malformed config marks misconfigured, boot continues | ✅ PASS | `config/__tests__/mcpConfig.test.ts` (7 bad shapes incl. `url:` remote) + client failed-handshake test |
| M7 | Timeout errors the call, transport stays usable | ✅ PASS | client M7 (30ms timeout → error; next call succeeds) + abort test |
| M8 | Full regression green | ✅ PASS | §1 snapshot |
| +1 | Real-spawn smoke (handshake+list+call+close over stdio) | ✅ PASS | client smoke test (`process.execPath -e` echo server, 30s cap) |

## 3. CHANGES (exact file list)

```
NEW:
  docs/PHASE-10-SPEC.md                    # approved spec (this build's contract)
  docs/PHASE-10-PROGRESS.md                # this file
  packages/core/src/version.ts             # CORE_VERSION leaf (breaks an import cycle, §5.1)
  packages/core/src/config/mcp.ts          # mcp.json load + validation
  packages/core/src/config/__tests__/mcpConfig.test.ts      # +3
  packages/core/src/mcp/transport.ts       # McpTransport, stdio impl, child registry
  packages/core/src/mcp/client.ts          # handshake/list/call, connectAllMcpServers
  packages/core/src/mcp/index.ts           # barrel
  packages/core/src/mcp/__tests__/fakeMcpTransport.ts       # in-memory fake (FakeProvider pattern)
  packages/core/src/mcp/__tests__/client.test.ts            # +8 (M1,M4,M6,M7,abort,pagination,smoke)
  packages/core/src/tools/mcpTools.ts      # naming/flags/dispatch/describe/collisions
  packages/core/src/tools/__tests__/mcpTools.test.ts        # +4 (M1,M5,routing,describe)
  packages/core/src/agent/__tests__/phase10.test.ts         # +4 (M1–M4 session-level)
  packages/tui/src/util/mcp.ts             # formatMcpStatus (pure)
  packages/tui/src/util/__tests__/mcp.test.ts               # +2
MODIFIED:
  packages/core/src/index.ts               # version leaf, mcp barrel, TOOL_DEFINITIONS + registerExternalExecutor
  packages/core/src/tools/index.ts         # registerExternalExecutor + external fallback in executeTool/describeToolInput
  packages/core/src/agent/subagent.ts      # subAgentTools(from?), runSubAgent opts.tools (P9-compat defaults)
  packages/core/src/agent/session.ts       # pass this.toolDefs into runSubAgent
  packages/cli/src/index.tsx               # async boot, connectAll (10s cap), defs+executor wiring, exit kill, /mcp state
  packages/tui/src/components/App.tsx      # McpAppState prop, mcp() handler
  packages/tui/src/commands/types.ts       # +mcp(sub?)
  packages/tui/src/commands/registry.ts    # +/mcp + /help example
  README.md                                # /mcp rows, MCP section (example, boundaries, risk)
```

Spec §9.3–9.5 docs requirements: README section ✅, `/mcp` ✅, `/help`
example ✅, `--help` line ✅, decisions unaltered except D0 (§5.2).

## 4. RESOLVED WHILE BUILDING (spec-conformant details)

- `connectAllMcpServers` (not in the spec's file list, implied by §3.4 "CLI
  boot" + "`/mcp` reconnect") is the single owner for both paths — no
  duplicated connect logic. Stale (removed-from-config) servers are closed
  and dropped.
- Executor resolves per call by scanning live connections (no name→server
  map), so reconnects refresh routing with no stale state.
- Reconnect does NOT hot-add tools to the running session (`toolDefs` is
  fixed at construction) — `/mcp reconnect` output and README say new tools
  need a restart. Deliberate v1 boundary, stated in UX copy.
- `registerExternalExecutor` dedupes by prefix (double boot/register safe).

## 5. FINDINGS (classified, per repo change-control)

- **FINDING-1 — SPEC DEVIATION, approved and recorded (D0).** Lenient
  version negotiation instead of the spec's strict echo-check. Rationale in
  `PHASE-10-SPEC.md` §8/D0. The pin (`2025-11-25`) is still declared.
- **FINDING-2 — PRE-EXISTING LANDMINE (not introduced here).** Two
  `ToolDefinition` interfaces share one name: `providers/types.ts` (no
  `mutating`) vs `tools/types.ts` (with `mutating`). The CLI's first draft
  annotated with the wrong flavor and failed typecheck loudly (good).
  Structural typing saves every internal handoff (tools flavor is a
  superset), so no behavior is affected — but any future `import type
  { ToolDefinition }` must say which one. Recommend unifying on the tools
  flavor in a later cleanup (tracking here, not doing it in this slice).
- **FINDING-3 — no violation.** `session.ts` + `subagent.ts` changes sit
  inside SPEC §3.4 (sub-agent inheritance); P9 tests unmodified and green.
- **FINDING-4 — TUI/CLI compile against core dist** (standing gotcha):
  bit twice this slice (App `mcp` prop; `TOOL_DEFINITIONS` export). Rule
  reconfirmed: `npm run build -w @anvil/core` before typecheck, always.

## 6. WHAT THIS DOES NOT DO (spec §2 + §5 boundaries, kept)

stdio-only, tools-only, no sampling, no retry/backoff, no keychain, no
adapter/compaction/loop/budget/session-format changes, memory-only
connections, no checkpoint coverage for MCP writes, no persisted MCP
sessions. All stated in README + `/mcp` copy where user-facing.

## 7. NEXT (head-of-project sequencing)

Phase 10 closes the last capability phase. Remaining roadmap: U10 (Phase 9
presentation UI), U12 (component-test infra), U13 (custom themes) — plus the
FINDING-2 ToolDefinition unification cleanup. Suggested next: U10, since
delegation + MCP multiply the "what is running right now" need the
collapsed-progress UI answers.
