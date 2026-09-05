# PHASE 10 SPEC — MCP: external tools via Model Context Protocol ("skills that run")

> Status: APPROVED (client directive "do it", 2026-09-05). The implementing
> agent must follow it exactly — no improvisation, no reordering, no trimming
> of acceptance criteria. One approved deviation is logged at the end of §8
> (version negotiation) — everything else built as written.

## 0. Product context

Anvil's built-in tools end at the project root: files, grep, shell. Everything
else (GitHub, databases, issue trackers, custom team workflows) today means
"paste output into chat by hand." MCP (open JSON-RPC standard, stdio transport)
is the bounded way to add those capabilities without growing Anvil's own tool
registry: servers run as local child processes, declare their tools as JSON
schemas, and Anvil treats them as first-class tools through the seams Phases
8–9 already built (`AgentOptions.tools`, name+hash loop guard, `mutating`
permission gate, ledger, checkpoints-not-applicable honesty).

Verified seams (read from source 2026-09-05, not assumed):
- `openai.ts:164-167`, `gemini.ts:202`, `anthropic.ts:163` pass
  `ToolDefinition.inputSchema` straight through — MCP JSON schemas ride with
  ZERO adapter changes.
- `tools/index.ts:38-60` dispatches by definition name — external tools need
  a dispatch extension, not a rewrite.
- `agent/session.ts` classifies by `def.mutating`, hashes by name+canonical
  input, ledgers every outcome — MCP tools inherit all of it free.
- No MCP code or SDK exists in the tree (only two seam comments:
  `session.ts:72`, `agent/types.ts:47`).

## 1. Objective

Configure local MCP servers in one file, connect at boot, list their tools,
inject them into the agent loop namespaced and permission-gated, execute
calls over stdio JSON-RPC, show server health — proven by automated tests
with a fake in-memory transport (no network, no real servers in tests).

## 2. Non-goals (enforce regardless of temptation)

- NO remote transports in v1 (no SSE, no Streamable HTTP, no auth/token
  flows). Local stdio processes cover the capability; remote servers are a
  credential-management project of their own. An explicit error tells users
  who configure a `url:` server that v1 is stdio-only.
- NO new runtime dependencies. The client is hand-rolled JSON-RPC 2.0 over
  stdio (~150 lines) — the repo's no-new-deps discipline holds. Rejected
  alternative recorded in §8.
- NO MCP prompts/resources/roots in v1. Tools only (`tools/list`,
  `tools/call`). Sampling (`sampling/createMessage`, i.e. the server calling
  back into the model) is explicitly refused with an error — the model loop
  stays single-owner.
- NO 429-style retry/backoff on tool calls (consistent with Phase 8:
  record, never hide). Failures surface as `isError` tool_results + server
  health state.
- NO persisted MCP credentials beyond `mcp.json` itself (0600, ANVIL_HOME-
  honoring like `credentials.json`). No keychain integration this phase.
- NO changes to provider adapters, compaction, loop/budget semantics, or
  the session-file format.

## 3. Scope

### 3.1 Config — `mcp.json` (new `config/mcp.ts`)

```ts
export interface McpServerConfig {
  command: string;              // argv[0], spawned WITHOUT shell
  args?: string[];              // default []
  env?: Record<string, string>; // merged over a minimal base (PATH, LANG) — never inherits Anvil's full env
  timeoutMs?: number;           // per-tools/call cap, default 60_000
}
export interface McpConfig { servers: Record<string, McpServerConfig> }
export function loadMcpConfig(): McpConfig;   // missing/corrupt → { servers: {} }, never throws
export function mcpConfigPath(): string;      // ANVIL_HOME-honoring, lazy (config/index.ts pattern)
```

- Unknown fields (`url`, `transport`, …) → server marked `misconfigured`
  with "v1 is stdio-only" (never silently ignored, never attempted).
- Server ids: `[a-z0-9-_]{1,40}` (lowercase); invalid ids → `misconfigured`.

### 3.2 Client — `providers/mcp.ts`? NO — new `mcp/` module (`mcp/client.ts`)

(Not providers/: MCP is a tool transport, not a model provider. New top-level
`packages/core/src/mcp/` with `client.ts`, `transport.ts`, `config.ts`…
config lives in `config/mcp.ts` beside credentials for the 0600 convention.)

```ts
export interface McpTransport {  // seam for the fake in tests
  send(msg: string): void;
  lines(): AsyncIterable<string>;  // newline-delimited JSON-RPC
  close(): void;
}
export function createStdioTransport(command, args, env): McpTransport;
export interface McpTool { serverId: string; name: string; description: string; inputSchema: Record<string, unknown>; readOnly: boolean }
export interface McpServerConnection {
  id: string;
  status: "ready" | "error" | "misconfigured";
  error?: string;
  tools: McpTool[];
}
export async function connectServer(id, cfg): Promise<McpServerConnection>;
// handshake: initialize (protocolVersion pin, clientInfo anvil/<CORE_VERSION>)
//   → notifications/initialized → tools/list. Any step failing → status error,
//   tools []. NEVER throws (boot must survive a dead server).
export async function callTool(conn, toolName, args, signal?, timeoutMs?): Promise<{ output: unknown; isError: boolean }>;
```

- Protocol version pin: declare one version, accept the server's reply only
  if it echoes a version we speak; else `error`. (Exact version fixed at
  implementation time from the MCP spec current then — recorded in the
  progress record, not here, so this spec doesn't rot.)
- `notifications/*` from the server (e.g. `tools/list_changed`): read and
  ignored in v1 (documented); `/mcp reconnect` re-lists.
- Timeout kills the CALL (error result), not the server process. Spawn
  failure / malformed JSON / JSON-RPC error → `isError` result + server
  `status` flips to `error` with `lastError` (health, §3.4).

### 3.3 Tool adapter — names, flags, dispatch (`tools/mcpTools.ts` + index)

```ts
export function toToolDefinitions(serverId, tools: McpTool[]): ToolDefinition[];
// name: `mcp_<serverId>__<tool>` (serverId already restricted; tool names
//   sanitized: [^a-zA-Z0-9_-] → _; collision with a built-in or another MCP
//   tool → that tool is DROPPED with a startup warning, first wins).
// description: `[mcp <serverId>] <original description>`.
// mutating: true UNLESS annotations.readOnlyHint === true. Unknown external
//   tools prompt by DEFAULT — safe direction, matches U11.
export function createMcpExecutor(conns: Map<id, conn>): ToolExecutor;
// routes by parsing the serverId back out of the name; unknown/misconfigured/
// error-status server → isError result (never throws into the loop).
```

- `executeTool` gains an external-executor fallback: unknown name →
  consult registered MCP executors → still-unknown → existing "Unknown tool"
  error. (Keeps the registry closed for built-ins, open for MCP.)
- `describeToolInput` fallback already previews JSON input; for `mcp_*`
  tools prefix the server description line. (U11 "schema + input shown":
  the model already receives the full JSON schema via the provider
  adapters; the human sees name + server + truncated input JSON.)

### 3.4 Session + lifecycle (CLI boot, `/mcp`, health)

- CLI boot (`cli/src/index.tsx`): after providers — `loadMcpConfig()` →
  `connectServer` each (parallel, each with a 10s connect cap) → build
  `ToolDefinition[]` + executor map → `new AgentSession(provider, { ...,
  tools: [...TOOL_DEFINITIONS, ...mcpDefs] })`. A dead server prints ONE
  startup warning line per server and NEVER blocks chat.
- Sub-agents inherit the main session's MCP tools (via the same `tools`
  array minus `delegate_task`, reusing `subAgentTools()` semantics) under
  the SAME shared permission broker. Rationale: repo-scale research is the
  delegation use case; prompts still gate every mutating MCP call.
- Health: connection keeps `{ status, lastError, toolCount }`. New
  read-only command `/mcp` prints per-server status + tool counts + errors,
  plus `/mcp reconnect` re-runs connect+list for all servers. (U11 server
  health indicators = this command in v1; no picker changes.)
- Loop guard, budget, ledger, compaction, checkpoints: inherited unchanged.
  Checkpoints do NOT cover MCP writes (same honesty as `run_command` —
  `/mcp` output and README say: only local file writes rewind).
- TUI `PermissionPrompt`: unknown-schema tools already render via the
  generic path; MCP rows show `⚠ mcp_<server>__<tool>` + server tag +
  truncated input JSON. No prompt-component changes expected; if the
  implementer finds one needed, it is a spec deviation to record.

### 3.5 Contract changes (exact)

```ts
// agent/types.ts — NO CHANGE (tools?: ToolDefinition[] seam already exists).
// tools/index.ts — additive only:
export function registerExternalExecutor(prefix: "mcp_", exec: ToolExecutor): void;
// mcp/* — all new files (client.ts, transport.ts, config in config/mcp.ts, tools adapter).
// AgentEvent — NO new variants (tool_started/finished cover MCP calls; connection
//   state is CLI/TUI chrome, reported via /mcp, not the turn stream).
```

## 4. Acceptance (fake in-memory transport, deterministic, no network)

- **M1** Fake transport serving 2 tools → `toToolDefinitions` names
  `mcp_srv__tool`, readOnly→non-mutating mapping correct, injected session
  lists them to the provider (assert via `FakeProvider.calls[0].tools`).
- **M2** Full round-trip: model calls `mcp_srv__tool` → executor routes to
  the fake → JSON result returns as non-error tool_result; ledger has
  tool_started/tool_finished for the namespaced name.
- **M3** Mutating MCP tool (no readOnlyHint) in a batch with a read →
  batch runs SERIAL (permission path), proving the `mutating` flag flows.
- **M4** Unknown tool name still errors; MCP name for a dead server →
  isError result, loop survives (then textTurn ends the turn).
- **M5** Name collision (MCP tool sanitizes onto a built-in name) → MCP
  tool dropped, startup warning recorded, built-in wins.
- **M6** Malformed `mcp.json` (bad JSON, bad id, `url:` server) →
  `loadMcpConfig`/validation marks misconfigured, boot continues with zero
  MCP tools, reasons reported (never throws).
- **M7** Timeout: fake transport that never answers → call errors after
  `timeoutMs` (use a tiny timeout in-test), server process NOT killed
  (stdio transport to a real `sleep` child? NO — assert via fake that a
  second call still works after the first times out).
- **M8** Full regression: all existing tests still green.

## 5. Sequencing (do not reorder)

1. `config/mcp.ts` + validation tests → 2. `mcp/transport.ts` (stdio) +
   fake transport → 3. `mcp/client.ts` handshake/list/call + tests (M1,M4
   partial,M6,M7) → 4. `tools/mcpTools.ts` naming/flags/dispatch + tests
   (M1,M2,M3,M5) → 5. CLI boot wiring + `/mcp` (+reconnect) + TUI copy →
   6. gates (`build core` → `typecheck` → core+tui tests → `build` →
   `git status` allowlist).

## 6. Known gotchas (from verified source)

- TUI/CLI compile against core's BUILT dist — rebuild core before
  typecheck (standing gotcha, `PHASE-8-PROGRESS.md` §5.1).
- FakeProvider script entries are per-provider-round; an MCP round-trip
  test needs main-call + textTurn entries like P9-1.
- `executeTool` wraps executor throws into isError — the MCP executor must
  still return WELL-FORMED results (not rely on the wrapper) so summaries
  stay truthful.
- Child-process env: merge `{PATH, LANG}` base + server `env` (bash.ts:66
  precedent) — never inherit Anvil's full env (API keys must not leak into
  servers).
- `spawn` WITHOUT shell, `detached: true` + killTree on shutdown
  (bash.ts:62-79 precedent) so servers never outlive Anvil.
- stdout framing: newline-delimited JSON-RPC; a server writing logs to
  stdout corrupts the stream — route child stderr to Anvil's stderr (logs
  stay visible, stream stays clean) and document it.
- Session resume: history may reference `mcp_*` tools whose servers are now
  absent → existing "Unknown tool" path handles it (no work).

## 7. Risks & rollback

- A malicious/buggy server sees tool ARGUMENTS (file contents sent as args).
  Mitigations: local-only servers, user-installed config, permission prompts
  on mutating calls, `/mcp` health visibility. Stated in README, not solved.
- Hand-rolled client may misread an odd-but-legal server → per-server error
  isolation (one bad server never breaks chat or other servers).
- Rollback: empty `mcp.json` = zero MCP surface; all changes additive.

## 8. DECISION LOG (proposed — approval requested)

| Decision | Alternatives rejected | Reason | Trade-off |
|---|---|---|---|
| stdio-only v1 | SSE/Streamable HTTP now | remote = auth/credential project; local covers the capability | remote users wait; explicit error instead of half-support |
| Hand-rolled JSON-RPC, no SDK dep | `@modelcontextprotocol/sdk` | no-new-deps discipline; ~150 lines; version control | we own protocol-subset maintenance; pin recorded at build |
| `mcp_<server>__<tool>` names | bare tool names + hidden server tag | collisions across servers; ledger/audit must show origin | longer names in transcripts |
| Default mutating=true | trust readOnlyHint-absent as safe | unknown external code prompts by default (U11 spirit) | more prompts until servers annotate |
| No sampling | full MCP (server→model callbacks) | single-owner model loop; Phase 8 non-goal lineage | servers needing sampling error visibly |
| Memory-only connections, `/mcp reconnect` | auto-reconnect/watchers | predictable lifecycle, no background surprises | list staleness until reconnect (stated) |
| Sub-agents inherit MCP tools | built-ins-only for subs | delegation use case is repo-scale research; broker still gates | wider blast radius per prompt — accepted, broker-gated |

### Approved deviation (logged 2026-09-05, head-of-project + client build order)

- **D0 — lenient version negotiation.** §3.2 as written demands accepting
  the handshake only when the server echoes our protocol version. Built
  instead: proceed with any answered version, recorded on the connection as
  `serverVersion` (`mcp/client.ts`). Reason: servers answer with their own
  version; strict echo would brick interop on any drift while the v1 subset
  (`initialize`, `tools/list`, `tools/call`) is stable across versions.
  Revisit only with a real interop failure in hand.

## 9. Definition of done

1. M1–M8 tests exist in `packages/core/src/**` (+ pure TUI `/mcp` format
   tests) and pass; regression gate green.
2. `git diff --stat` limited to the allowlist the implementer records.
3. README documents `mcp.json` (with a minimal example), the stdio-only
   boundary, the no-rewind boundary, and the server-sees-arguments risk.
4. `/mcp` output, `/help` example, `--help` line all present.
5. §8 decisions not silently altered — deviations recorded as findings.
