# Changelog

All notable changes to Anvil are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/); versions follow semver
## [Unreleased]

### Guardian Rules Scoped to Their Own Project (2026-09-20)

- **Anvil's repo-specific rules were being enforced on every project it scanned.** The
  guardian's built-in families name Anvil's own APIs — the raw-error family's auto-fix rewrites
  a fallback into a call to an `@anvil/core` helper, the architecture family asserts the
  core/tui/cli boundary, and the color and placeholder families encode this repo's conventions.
  Applied to a user's project those rules can only misfire, and the auto-fix was actively
  harmful: it rewrote the code into a call to an identifier that does not exist there.
  `guardian/scope.ts` now classifies a scan as `"anvil"` (this monorepo) or `"foreign"` (anything
  else) from repo identity — a `packages/core/package.json` declaring `@anvil/core` — cached per
  root and never throwing. Each rule carries a `scope`: Anvil-only families are skipped entirely
  outside Anvil, while the universal families (type escape, silent catch) apply everywhere.
  Project-declared rules stay unconditional, so a project that opts in by writing its own rule is
  still enforced. Closes `STABILIZATION-ROADMAP-2026-09.md` S5.1/S5.2 (F2); S5.3, the
  syntax-aware import check, is left open and recorded as such.
- **The guardian also treated prose as code.** Anvil's own roadmap markdown was blocked twice by
  the turn interceptor — once by the architecture rule on a quoted import path inside a sentence,
  once by the placeholder rule on the word used as prose. The built-ins now skip positively
  non-code extensions, mirroring the gate's source-only PATHSPEC, while a name with no extension
  (the `"(working tree)"` label the CLI passes) is still scanned as code so the working-tree scan
  cannot be silently disabled.
- Reproduced red first: the session-level auto-fix tests failed because a bare temp root now
  classifies as `"foreign"`, where that family correctly never fires — the fixtures were fixed to
  declare their identity rather than the rule being widened back. Green: 800 tests (core 531 /
  tui 228 / cli 41), full `npm run typecheck`, full `npm run gate`.

### `edit_file` Result Size Capped (2026-09-20)

- **A small, legal file plus a huge `new_str` bypassed the write cap.** `edit_file` bounded
  the *source* file but never the *result*, so a 10 KB file and a 1 MB replacement were
  patched and written unchecked — `write_file` has capped content since day one; the edit
  path had a hole on the write side. The cap now runs on the result, immediately after the
  substitution and **before** `createTwoFilesPatch` allocates its two copies, and raises
  `EditValidationError` so the executor returns the clean `{error, summary}` shape and never
  reaches `atomicWriteText`.
- Reproduced red first: against the previous source the same call returned `isError: false`
  and the ~1 MB file landed on disk. Green: `editFile.test.ts` 8/8. Closes the
  `STABILIZATION-ROADMAP-2026-09.md` S4.2 (F12) items.

### Pre-Execution Audit Re-classified Against the Live Tree (2026-09-20)

- **The audit doc was misdirecting every agent that followed the entry protocol.**
  `docs/PHASE-21-25-AUDIT.md` still flagged ~20 items as 🔴 LIVE that are fixed in the live
  code — and AGENTS.md §1.5 sends each agent there *first*. Re-verified every matrix item by
  symbol: all 26 are now green. `22.13` remains **🟣 BY-DESIGN — do not change it**; `22.9`,
  `22.11`, and `22.17` were promoted from unverified to confirmed fixed with traced evidence;
  `23.4` is recorded honestly as **partial** (one component memoized, not the set).
- Corrected the stale test count **556 → 788** (core 519 / tui 228 / cli 41, 121 files) and
  marked the "the gate only scans NEW lines" section **resolved** — gate Step 1.5 already
  enforces it, so the doc had been contradicting its own gate-hardening notes.
- Protected-artifact change: the audit doc's SHA-256 in `scripts/gate-manifest.json` is
  regenerated in the same commit (AGENTS.md §3.4b). No gate, allowlist, sentinel, or CI file
  was modified.

### MCP Transport Hardened Against Hostile or Broken Servers (2026-09-20)

- **A silent server could hang the connect path forever.** The SSE connect budget was
  installed only *after* the initial GET resolved, so a server that accepted the connection
  and never answered left the fetch pending with nothing able to abort it — measured at
  **still-pending 2s into a 300ms budget** against the previous build. One deadline now covers
  the GET, endpoint discovery, and the first byte; it is installed before the request and
  cleared once the endpoint is known (the stream must outlive it).
- **Failed connect attempts leaked their stream.** An endpoint timeout rejected the caller but
  never aborted or untracked the open stream (measured: **1 stream still open and retained**
  after the failure). Every failed-attempt path now aborts, untracks, and finishes its own
  pump, and each retry gets a fresh pump — a single shared pump meant a retry could read an
  already-finished stream.
- **Unbounded server-controlled memory is closed.** The pump queue had no cap, an unterminated
  SSE frame could grow without limit, and the POST path buffered a whole response before any
  size check. All three are byte-capped now (`MCP_MAX_PUMP_QUEUE_LINES` / `_BYTES` are
  env-overridable), the response is read with the cap enforced *during* the read, and overflow
  fails the transport — pending calls error as closed rather than messages vanishing silently.
- **The POST target has a stated policy.** The `endpoint` event is server-controlled and
  decides where auth headers and tool payloads are sent, so an off-origin endpoint is refused
  terminally (with a credential-free message), and redirects are refused on both the GET and
  every POST. Documented in the module header, README §MCP servers, and the roadmap.
- Closes the `STABILIZATION-ROADMAP-2026-09.md` S3.1 and S3.2 items. Pre-fix behavior was
  reproduced against the previous build before any of it was changed.

### Read-Only Safe-List Escape Closed (2026-09-20)

- **`git diff` could read any host file with no permission prompt.** The read-only
  safe-list gated a subcommand's *name* but never its arguments, so
  `git diff --no-index /dev/null <host path>` streamed that host file straight into
  the model's context — in every mode, including unattended headless runs where no
  human gate exists. The same branch made `--output` a prompt-free **write**
  primitive: `git diff --no-index --output=<path> …` serializes the diff into an
  arbitrary path, and the write lands even though the command exits non-zero and the
  tool reports an error. Subcommand arguments now get the same project-root
  containment the file readers already had, escape flags are refused by prefix so
  git's own abbreviations (`--no-ind`, `--out=x`) cannot slip past an exact-name
  check, and a subcommand with no `projectRoot` fails closed like the readers.
- Found by an adversarial audit of the sibling branch Phase 21.1 never covered.
  Red/green regression test in `bash.test.ts` (escapes and abbreviations refused;
  `git status`, `git log --oneline`, `git diff --stat` stay prompt-free).
- **The safe-list is now auditable, and the docs stop implying it is a sandbox.** A 58-row
  verdict table records every safe-listed binary with the basis for its verdict (contained /
  inert / metadata / gated), so the auto-allow is a reviewed policy rather than an assumption.
  README §Safety distinguishes project-contained readers from inert printers and states that
  the containment is lexical — a usability policy, not a security boundary — and the `bash.ts`
  header carries the same caveat for the destructive-command filter. Closes the §S4.1 items
  and the S2/S1 residue doc box in `docs/STABILIZATION-ROADMAP-2026-09.md`.

### Guardian Scan Surface Corrected (2026-09-20)

- **The interceptor could not match anything outside `write_file` / `edit_file`.** For every
  other mutating tool it scanned the permission-prompt preview, whose shapes (a
  `Run command: …` line, a `Parameters:` bullet list) contain no `+` lines — and the diff
  scanner only inspects added lines. An MCP or plugin tool writing a file therefore passed
  through unscanned while the guardian advertised coverage; the accompanying comment
  asserted the preview was a unified diff, which no registered preview implementation
  returns. Those calls are now scanned through the tool's declared file-body fields, and the
  comment states the real scope instead of implying one.
- **`run_command` is documented as deliberately NOT scanned.** It declares no `path`, and
  scanning raw command text would refuse legitimate commands (a grep for a placeholder
  marker is not slop, and the model cannot "fix" a legitimate argument). Shell mutations
  remain gated by the permission prompt and the destructive-command refusal. Both limits are
  now stated in the `guardianIntercept` doc comment.
- Regression tests: a mutating external tool whose body carries a violation is refused with
  its executor never running, and the same tool with a clean body runs.

### Phase 26.2 — `anvil gate --watch` (2026-09-19)

- **Continuous guarding of the working tree**: `anvil gate --watch` re-scans the
  dirty-file diff vs HEAD on a debounce, so slop surfaces as it appears instead of only
  at turn ends. Debounce coalesces write bursts and a minimum gap bounds scan rate via
  named `GUARDIAN_WATCH_*` constants (interval 500ms, 60 scans/min, env-overridable).
- **Honest scope**: the banner states it covers the diff vs HEAD only, and points at
  `npm run gate` (Step 1.5) for full-tree coverage. Clean trees stay silent; recovery from
  a dirty state is reported.

### Phase 26.0 + 26.1 — Guardian Rules Bridge and Turn Report (2026-09-19)

- **Project rules are now enforced, not just advised**: a repo can declare machine-
  enforceable rules in an `<!-- guardian:rules -->` block in `AGENTS.md` / `.anvil/rules`;
  they are parsed once per session and applied by the turn interceptor alongside the
  built-ins (same block a foreign agent can be provisioned with).
- **`.fresh-allowlist.json` read side added**: `loadFreshAllowlist` validates the file
  against the gate's own shape rules (broad/malformed entries rejected, never half-loaded) —
  the data source the health telemetry will need.
- **Guardian violations are structured**: each carries a `family` (type-escape, raw-error,
  style, architecture, placeholder, rule) and repaired violations are reported as
  `autofixed` rather than silently dropped.
- **Guardian turn report**: a `GuardianReportCard` renders what was blocked and auto-fixed,
  with per-violation `file:line` and rule family; the headless/CI stderr line keeps its
  stable `guardian_blocked count=N fixed=M` shape.

### Core Hygiene + Engine Modularization (2026-09-19)

- **Guardian false-negative fixed**: the turn interceptor's post-fix re-scan dropped
  raw-error violations that survived repair whenever the auto-fix budget was unspent,
  silently allowing them through. Repairs now re-scan and only fixed occurrences drop
  out; an unfixable survivor blocks the turn. Regression test added.
- **Guardian repair text corrected**: the `no-hardcoded-color` guidance pointed the
  model at `@anvil/core`; `useTheme()` lives in the TUI package.
- **Anti-slop gate closed a blind spot**: `verify-gate.mjs` Steps 1/1.5 now also reject
  bare `any` type annotations (`: any`, `<any>`, `any[]`), which the cast-only rule could
  not see. Step 0 sensor fixture added; manifest and sentinel regenerated together.
- **Session-tool seam typed**: `ToolSessionContext` no longer exposes `unknown`
  provider/broker/ledger fields, and `SessionToolExecutor` yields `AgentEvent`. Six
  casts removed at the seam.
- **Bare `any` production sites eliminated**: a real `OrcarouterCatalogModel` interface
  replaces the catalog cast; goal-plan parsing narrows `unknown`; the session-tool
  generators return typed events.
- **`AgentSession.send()` modularized**: reactive compaction, the native guardian gate,
  and loop-guard/session-tool dispatch extracted into private methods. `send()` fell
  from ~388 to 209 lines with no behavior change (event order, ledger, checkpoints, and
  cancellation paths are unchanged).

### Phase 25.7 Closed — Live Eval 93.3% (14/15) at $0 (2026-09-18)

- **The ≥80% real-provider box is closed**: 14/15 tasks passed on
  `openrouter` / `deepseek/deepseek-v4-flash-0731:free` (free tier, $0), 100% tool
  engagement, task times 11.8s–50.2s. Model chosen by probing the live OpenRouter catalog
  (21 free tool-capable models) and validating candidates with a real tool round-trip
  before the full run.
- **Harness unblocked, not relaxed by default**: every task.json hardcoded a 30000ms
  budget tuned for the instant mock provider, and per-task config beat any operator
  override — a passing task once landed at 29.27s, 0.73s under the cap. Replaced both
  runner literals with `EVAL_TASK_TIMEOUT_MS` (env `ANVIL_EVAL_TIMEOUT_MS`, default
  unchanged at 30s) and gave an env-set timeout precedence over per-task config in
  `run.ts`. Mock lane re-verified: still 15/15.
- **The single failure is honest**: `11-multifile-extract-interface` timed out at 180s
  after 13 tool calls — a real capability gap for that task size, now measurable instead
  of hidden by the clock.

### Live Eval Lane Validated & Stale Certification Corrected (2026-09-18)

- **The live eval lane runs end-to-end**: `npx tsx evals/run.ts --provider gemini
  --model gemini-3.6-flash` ran real agent turns against the live API (task 01 passed
  with 6 tool calls in 24.7s), so the harness's live path is proven — not just the mock
  path that CI gates on.
- **A retired model was falsely advertised as certified live**: `gemini-2.0-flash` sat in
  the model registry with `isFree: true` and `certified: "live"` (2026-09-10) and was named
  in the README certified-model table, but the API answers *"This model
  models/gemini-2.0-flash is no longer available. Please update your code to use
  models/gemini-3.6-flash."* It is now `certified: "broken"`, so the picker shows
  `[❌ broken]` rather than a false `[✅ live]`, with the probe evidence recorded inline.
- **Certification rots — a "live" result is a timestamp, not a property.** The remaining
  Gemini ids (`gemini-1.5-pro`, `gemini-1.5-flash`) are now marked unverified in the README
  rather than assumed working.
- **Phase 25.7's live-eval box stays OPEN.** The full live run scored 1/15, but that result
  is invalid as a quality signal: 3 tasks hit the harness's 30s per-task limit with zero tool
  calls and 5 more failed in ~0.03s, i.e. the model was never reached — free-tier quota, not
  agent capability. It must be re-run on a key with sufficient quota.

### Honest Headless Exit Status (2026-09-18, S1.4)

- **An unverified failed turn no longer exits 0**: `anvil -p` and goal runs returned
  exit code 0 for a turn that mutated files and left the test suite failing.
  `verification_gave_up` carried no exit code, and since it is emitted *before*
  `turn_complete` while `headless.ts` returns on the first exit code it sees, the
  terminal `turn_complete`'s 0 won the race. It now returns a distinct
  `EXIT_UNVERIFIED` (3). A failure that is later repaired still exits 0 — only the
  terminal verdict counts, so verify-fail → repair → verify-pass is not poisoned.
- **Named exit codes**: `EXIT_OK` (0), `EXIT_ERROR` (1), `EXIT_BUDGET_EXHAUSTED` (2),
  `EXIT_UNVERIFIED` (3) and `EXIT_CANCELLED` (130) replace the inline literals in
  `terminalRenderer.ts`, so CI-facing codes cannot drift. The full mapping table is
  recorded in `docs/STABILIZATION-ROADMAP-2026-09.md` §S1.4.

### Verified Repair Recovery & Malformed-Input Provenance (2026-09-18, S1.x + 22.2)

- **A repaired verification failure no longer fails its milestone**: `GoalEngine`
  accumulated `verificationFailed` as a sticky flag — once any probe failed, the
  milestone was marked failed even after a successful repair. Since S1.2 always
  probes the final state, every repaired turn emits `verification_result(false)`
  followed by `verification_result(true)`, so a repair could never rescue a
  milestone. The outcome now reports the **last** verdict; `verification_gave_up`
  remains terminal (it is only emitted when the final state still fails). Covered
  by two new `goalEngine` tests (repaired turn completes; unrecovered turn still
  fails).
- **Malformed tool-call JSON keeps its provenance (roadmap 22.2)**: the shared
  `ToolCallAssembler` collapsed an unparseable `tool_call` argument buffer to `{}`,
  so tools whose inputs are all-optional executed on invented defaults and the
  model was never told its JSON was malformed. The assembler now emits the
  existing `{ __parseError, rawInput }` sentinel that `executeTool` and the
  orchestrator already convert into a model-visible error — the OpenAI-shaped
  stream path previously made that handling unreachable. Covered in
  `streaming.test.ts` (malformed → sentinel; genuinely empty args → `{}`).



### Partial-Stream Retry Semantics (2026-09-18, S2.2)

- **Deltas are never replayed**: a mid-stream provider error (e.g. HTTP 503 after text deltas
  were already surfaced) used to trigger a full stream restart on the retry attempt, re-delivering
  deltas the consumer had already seen. `BaseProvider.streamCompletion` now tracks whether any
  event was surfaced in the current attempt and only retries a thrown/retryable error while
  nothing has been delivered.
- **Abandoned iterators are closed**: a first-event retryable error used to leave the underlying
  stream open (leaked connection, potential stale events). The retry path now explicitly closes
  the abandoned iterator before backing off.
- **Retry backoff is abortable**: backoff sleeps now honor `request.signal` via the shared
  `sleepAbortable` helper (hoisted from `session.ts` into `core/errors.ts`, also used by the
  session rate-limit retry); aborting mid-backoff surfaces a cancellation error event instead of
  waking up to hammer a struggling endpoint.

### Verification Completes the Loop & Checkpoints Match Reality (2026-09-18, S1.2 + S1.3)

- **The final repair is now verified (S1.2)**: reaching the repair budget used to skip the last
  verification entirely, so a turn could complete with an untested mutation and no verdict.
  `verifyTurnMutations` now splits "may request another repair" from "may run verification" —
  the final state is always probed; a passing final repair reports `passed`, a still-failing
  one reports `verification_gave_up` (with the real failure probe on the ledger instead of a
  zero-effort marker). Bounded: no extra repair prompts, one extra probe.
- **Cancellation no longer loses undo entries (S1.3)**: cancelling mid-batch used to drop the
  pending checkpoint — mutations that completed before the abort existed on disk with no rewind
  coverage. The cancel path now commits the pending snapshot for succeeded calls before emitting
  `cancelled`.
- **Checkpoints only cover paths that actually changed**: `commitRewindSnapshot` previously
  committed the whole pre-batch snapshot (all write/edit targets) if ANY call succeeded, so a
  denied/failed call's file falsely claimed undo coverage. It now filters entries to write/edit
  targets whose calls succeeded.

### Execution Truthfulness & Team Budget Enforcement (2026-09-18)

- **Guardian refusals now match execution (S1.1)**: tool calls blocked by the native guardian
  interceptor are recorded in a `guardianBlocked` set and skipped by the dispatch loop, so a
  refusal can no longer be reported while the mutation executes anyway. The refusal check for
  loop-guard refusals (`p.refused`) now runs **before** session-tool handling — a loop-refused
  `delegate_task`/`update_plan` never reaches its executor. Covered by a rewritten
  `guardianDispatch.test.ts` (blocked-write never touches the filesystem, mixed-batch isolation,
  auto-fix happy path, refused session-tool ordering).
- **Team iteration budget is enforced**: `delegate_task`'s team runner computed per-member
  iteration budgets (`splitBudget`) but handed them to sub-agents as an ignored `_budget`
  parameter — members ran unbounded. Sub-agent sessions now receive their real budget (per-member
  `maxInnerIterations` overrides clamp to `[1, total]`). A 2-member × 1-iteration team now makes
  4 provider calls instead of 10.
- **Anthropic usage events fixed**: `message_delta` billing usage is flat on the event
  (SDK `RawMessageDeltaEvent.usage: MessageDeltaUsage`, cumulative), not nested under `delta` —
  the adapter now reads the real shape (legacy `delta.usage` still tolerated) so token accounting
  and compaction triggers work on live Anthropic streams; the stream cast is now single-step.
- **Dead code removed**: unused `BaseProvider.streamWithRetry` (no adapter ever called it).

### Phase 25 Wired into Product Paths
- **Plugins (25.4)**: load once at boot in `resolveBootContext` — executors
  registered, plugin prompts merged with MCP tools into `sessionTools`
  (built-ins + plugin defs + MCP); problems surface as boot diagnostics.
  `headless.ts` and `goalRunner.ts` consume the same `sessionTools` plumbing.
  Goal mode gets plugin tools but not plugin prompts (prompt assembly is
  GoalEngine-internal — noted in the audit doc).
- **Guardian interceptor (25.6)**: new `guardian_blocked` event
  (`{count, fixed, firstRule}`) rendered to stderr (cli) and as a system
  message (tui). The agent session gates pending file mutations before
  execution — literal content for `write_file`/`edit_file`, `describeToolInput`
  previews for command-based mutations — auto-fixes raw-error formatting in
  place, refuses surviving violations with repair prompts, and records
  `loop_refused` ledger entries. The unused `GUARDIAN_BLOCKED_TOOL_PREFIX`
  constant was removed (refused calls never execute, so they never register
  verifier baselines).
- **Selective compaction (25.5)**: `compactIfNeeded` keeps high-relevance older
  messages verbatim via context scoring (`selectiveKeep`, task-seeded; empty
  task falls back to recency) instead of blanket-rolling everything into the
  summary.
- **Team runner (25.2)**: `delegate_task` accepts an optional `team` spec
  (`strategy`: parallel | pipeline | review, `members` with `{id, task}`) and
  routes through the real `runTeam` orchestrator; members run as live
  sub-agents sharing the permission broker, signal, and checkpoint merging.
  Per-member start/finish events stream to the parent turn; `AgentSession`
  records the last run (`session.teamRun`) and `/team status` reports real
  strategy, per-member status (ok/failed/aborted), tool calls, token totals,
  and report sizes instead of a static placeholder.
- **Gate coverage + type hygiene**: root `scripts/` now joins the gate's
  full-tree residual scan (Step 1.5) — one-off tooling can no longer hide
  legacy slop outside every workspace tsconfig; the gate script self-exempts
  (it IS the rule book). A dedicated `tsconfig.scripts.json` (wired into
  `npm run typecheck`) type-checks root + per-package `scripts/` — it
  immediately caught two latent fake-tool-definition bugs in
  `verify-openrouter.ts`/`verify-orcarouter.ts` (missing required `mutating`
  flag), now fixed.

### Design System Foundations (DW-1)
- 11 legacy theme colors (stable file format) + 15 derived semantic tokens
  (`brand`, `success/warning/error/info`, `text*`, `borderFocus`, …) with
  defaulted typography/spacing/borders/responsive sections — old
  `~/.anvil/themes.json` files auto-migrate.
- New built-in themes `midnight` and `hacker`; `useTerminalSize()` responsive
  breakpoints; `CHROME` unicode library with `meter()`/`rule()` helpers.

### Component Redesign (DW-2)
- Framed cockpit Header (status dot) and StatusBar (block-bar gauge, compact
  two-line stack); card-style message headers; boxed permission buttons;
  picker context-window badges; input history-recall indicator. Keyboard
  contracts unchanged.

### Interaction Polish (DW-3)
- Context-matched spinners (dots/pulse/arrows/blocks), blinking streaming
  cursor, command palette (prefix+fuzzy+MRU, icons), focus-bright palette
  border.

### Terminal Platform (DW-4)
- Adaptive `ContextGauge`, token-growth sparklines, alt-screen boot, long-turn
  notifications (bell + OSC 777/9), OSC 52 `/copy` + DiffModal `c`, terminal
  background detection for the default theme.
- Side-by-side diff view (auto at 120+ columns, `s` toggles) in DiffModal.
- Card timestamps (`HH:MM` right edge, `/expand` toggles; resumed history stays bare).

## [1.0.0] — 2026-09-14

### Next-Gen Evolution (Phase 25)

- **Phase 25.1 SSE/HTTP MCP Transport (verified)**:
  - Remote MCP servers over SSE with Bearer auth, reconnect, TLS enforcement (`packages/core/src/mcp/transport.ts`, `packages/core/src/config/mcp.ts`). Existing stdio tests still pass.
- **Phase 25.2 Multi-Agent Collaboration (Agent Teams)**:
  - `AgentTeam` orchestrator in `packages/core/src/agent/team/` — parallel, pipeline (serial handoff), and review strategies with budget splitting, failure isolation, and merged reports.
- **Phase 25.3 LSP Integration for Code Intelligence**:
  - LSP client in `packages/core/src/lsp/` (stdio JSON-RPC, auto-detect for TypeScript/Python/Rust/Go) plus four new tools: `goto_definition`, `find_references`, `get_hover`, `get_diagnostics`. `get_outline` remains the fast regex path; LSP upgrades precision when a server is installed, otherwise tools report an honest `fallback` source.
- **Phase 25.4 Plugin System**:
  - Manifest loading from `~/.anvil/plugins/<name>/plugin.json` (`packages/core/src/plugins/`), tool registration through the MCP-grade permission model (`plugin_<name>__<tool>`), `/plugin list` in the TUI.
- **Phase 25.5 Intelligent Context Management**:
  - Relevance scoring (keyword + recency + file-aware) in `packages/core/src/agent/context/`, selective compaction keeps, token-budget breakdown, and `/context` command with predictive compaction warnings.
- **Phase 25.6 Native Guardian Engine**:
  - In-process slop scanner + pre-turn interceptor (`packages/core/src/guardian/`) with safe auto-fix for raw error formatting; first-class `anvil gate [--full]` and `anvil init --guarded [--lang]` CLI commands.
- **New slash commands**: `/team`, `/plugin`, `/context` (plus `/plugin lsp` server inventory).

## [0.11.0] — 2026-09-14

### Refinement & Tech Debt

- **Phase 24.1 Provider Stream Retry with Backoff**:
  - Added `streamWithRetry` in `BaseProvider` with exponential backoff and jitter for transient provider failures (HTTP 429, 502, 503, `ECONNRESET`, `ETIMEDOUT`). Non-retryable errors fail immediately without retry delay.
- **Phase 24.2 MCP Auto-Reconnection on Transport Failure**:
  - Implemented transport health monitoring in `mcp/client.ts`. If an MCP server transport dies during tool execution, `callTool` automatically reconnects to the server and re-executes the invocation.
- **Phase 24.3 & 24.11 Dead Code & Obsolete Export Purge**:
  - Purged unused `toProviderTools()` and `toProviderMessages()` methods from `BaseProvider`.
  - Removed unused `ORCAROUTER_KNOWN_FREE_IDS` export from `freeModels.ts` and unused `AssembledCall` interface from `streaming.ts`.
- **Phase 24.4 Type Safety Hardening**:
  - Replaced `Array<any>` in `freeModels.ts` with typed `OpenRouterModel` interface.
  - Eliminated `as never` type assertions in Gemini and OpenAI provider streaming pipelines using discriminated union checks.
- **Phase 24.5 Structured Stderr Logger**:
  - Added `packages/core/src/logger.ts` supporting `info`, `warn`, `error`, and environment-gated `debug` logs (`ANVIL_DEBUG=1`).
- **Phase 24.6 Credential File Permission Verification**:
  - Added POSIX file mode verification in `config/index.ts` to warn users when credentials file permissions are looser than `0600`.
- **Phase 24.7 Standardized Provider Error Taxonomy**:
  - Introduced `ProviderErrorCode` union and `classifyProviderError` helper in `providers/types.ts`. All 10 provider adapters emit standardized `code`, `httpStatus`, and `isRetryable` fields.
- **Phase 24.8 Compaction Summarizer Quota Isolation**:
  - Added `compactionModel` setting to isolate compaction turns on low-RPM models. Compaction rate limits log a warning and fall back gracefully rather than aborting active turns.
- **Phase 24.9 Centralized Typed Constants**:
  - Centralized over 20 magic limits into typed configuration in `packages/core/src/config/constants.ts` with environment variable overrides (`ANVIL_MAX_READ_BYTES`, `ANVIL_COMPACTION_THRESHOLD`, etc.).
- **Phase 24.10 Error Formatting Consolidation (`getErrorMessage`)**:
  - Replaced over 45 instances of raw `err instanceof Error ? ...` ternary duplications monorepo-wide with central `getErrorMessage(err)` utility.
- **Phase 24.12 Monolithic Mega-File Modularization**:
  - Extracted closed-loop auto-verification into `packages/core/src/agent/turnVerifier.ts`, reducing `session.ts:send()` from 525 to 270 lines (< 300 target).
  - Extracted event reduction and display capping into `packages/tui/src/hooks/eventReducer.ts`.
  - Modularized TUI slash commands into domain handlers under `packages/tui/src/commands/handlers/`, reducing `commands/registry.ts` from 572 to 216 lines.
- **Phase 24.13 Unified CLI Terminal Event Renderer**:
  - Extracted `packages/cli/src/terminalRenderer.ts` shared across headless and goal modes, deduplicating terminal streaming and event rendering loops.
- **Phase 24.14 Rich MCP Tool Permission Prompts (UX Item U11 Closed)**:
  - Formatted MCP tool parameter payloads as structured bullet points (`• key: value`) and styled server origin badges (`[mcp:<server>]`) with accent colors in `PermissionPrompt.tsx`.
- **Phase 24.15 Windows Portability Boundary & Detection**:
  - Added platform detection in `bash.ts` and test runner scripts with actionable guidance when running under unsupported native Windows shells without bash/WSL.
- **Phase 24.16 Elimination of Dummy Tool Stubs**:
  - Converted `update_plan` and `delegate_task` into execution-context tools (`SessionToolExecutor`) supporting live streaming generator events; purged hardcoded string-matching intercepts from `session.ts`.
- **Phase 24.17 Deliverables & Version Bump**:
  - Bumped core, TUI, and CLI packages to `v0.11.0`. Updated visual regression baselines and roadmaps.

## [0.10.0] — 2026-09-13

### Stability & Performance

- **Phase 23.1 Elimination of Silent `catch {}` Blocks**:
  - Replaced silent `catch {}` blocks across core and provider packages (`config/index.ts`, `bash.ts`, `checkpoints.ts`, `awareness.ts`, `cache.ts`, `session.ts`, `orchestrator.ts`) with descriptive warning logs or explicit intentional swallow comments.
- **Phase 23.2 Amortized O(1) Run Ledger Recording**:
  - Replaced O(n²) array cloning on every ledger record (`this.ledger = capLedger([...this.ledger, entry])`) in `AgentSession` with in-place `.push()` and amortized `capLedger()` pruning when exceeding bounds.
- **Phase 23.3 History Compaction Cut Optimization**:
  - Pre-computed `splitCuts = new Set<number>()` in `findCleanCompactionCut` (`packages/core/src/agent/compaction.ts`), eliminating O(n²) `intervals.some()` iterations during reactive conversation compaction.
- **Phase 23.4 Hot-Path TUI Component Memoization**:
  - Wrapped `MessageView` in `React.memo` to prevent re-rendering full message history upon every incoming streaming token chunk.
- **Phase 23.5 Word-Diff LCS Bailout Threshold Tuning**:
  - Lowered word-level LCS computation bailout threshold from 50,000 to 10,000 operations in `packages/tui/src/diff/wordDiff.ts`, avoiding UI hang on massive diffs while falling back safely to whole-token replacement.
- **Phase 23.8 Stream Delta Backpressure Buffer (60 FPS Token Throttle)**:
  - Implemented backpressure token batching in `packages/tui/src/hooks/useAgentController.ts` with a 16ms (~60 FPS) throttle window. Prevents high-throughput models (Groq, Cerebras, Gemini Flash at 100-200 tok/sec) from choking the Node.js event loop with hundreds of layout recalculations per second while ensuring immediate responsiveness to Esc/Ctrl+C and instant flushing on tool calls and turn completion.

## [0.9.1] — 2026-09-13

### Fixed

- **Phase 22.1 Cancellation Signal Preservation Before Turn Start**:
  - Added `pendingCancel` state to `AgentSession` so calling `session.cancel()` before the first `session.send()` promptly aborts the controller upon turn initialization instead of silently dropping the cancel request.
- **Phase 22.2 Malformed Tool Call JSON Error Handling**:
  - Replaced silent `{}` fallback on malformed tool arguments with `{ __parseError: true, rawInput }`.
  - Tool execution in `orchestrator.ts` and `executeTool` detects syntax errors and returns `isError: true` with error details, allowing the model to receive feedback and retry with valid JSON.
- **Phase 22.3 Gemini Compacted History Orphan Tool Result Containment**:
  - In `toGeminiContents`, orphaned tool results whose origin tool calls were pruned by history compaction are skipped instead of emitting a synthetic `"unknown_tool"` name that causes Gemini API 400 validation failures.
- **Phase 22.4 Free Model Registry Pricing Heuristic**:
  - Replaced strict string comparison with numeric pricing checks in `freeModels.ts`, correctly classifying models with `"0"`, `"0.0"`, and numeric `0` prices as free tier.
- **Phase 22.5 Goal Engine Review Verdict Parsing**:
  - Relaxed regex parser in `goalEngine.ts` to accept valid affirmative reviews (e.g. `"YES."`, `"YES\n- details"`, `"YES, all criteria met"`) while continuing to reject hedges (e.g. `"YES, but/however..."`).
- **Phase 22.6 Binary File Detection in `read_file`**:
  - Added 8KB null-byte sniffing to `readFile.ts` to detect binary files and return an error result, preventing token waste and corrupted replacement characters in context.
- **Phase 22.7 Ollama Keyless Selection**:
  - Configured `KEYLESS_PROVIDERS` in `config/index.ts` so selecting `--provider ollama` succeeds without requiring an API key, while preserving first-run setup prompts when no provider is explicitly chosen and credentials are empty.
- **Phase 22.8 Vision Filtering on Non-Vision Providers**:
  - Added `supportsVision` option to `ChatCompletionsStyleProvider` in `openai.ts` (configured `false` for Groq, Cerebras, and Mistral), omitting image payloads with a clear textual omission note for providers lacking multi-modal support.
- **Phase 22.9 Checkpoint Store Error Containment & Logging**:
  - Wrapped `checkpointStore.ts` read and save operations with error logging via `getErrorMessage` instead of silent failures, preventing unobserved checkpoint loss.
- **Phase 22.10 Async Workspace Directory Introspection**:
  - Replaced synchronous `fs.readdirSync` with asynchronous `await fs.promises.readdir` in `analyzeWorkspace` (`awareness.ts`).
- **Phase 22.12 Session Rename In-Memory State Synchronization**:
  - Updated `/session rename` command handler in `packages/tui/src/commands/registry.ts` to synchronize `session.title = title` in memory, preventing subsequent autosaves from reverting the title on disk.
- **Phase 22.17 Surface MCP Boot Notices on TUI Startup**:
  - Added startup effect in `packages/tui/src/components/App.tsx` that prints MCP initialization notices and configuration warnings (e.g. malformed `~/.anvil/mcp.json` or connection failures) to the transcript immediately upon TUI launch.

## [0.9.0] — 2026-09-13

### Security

- **Phase 21.1 Shell Quote Path Traversal Bypass in `run_command`**:
  - Added `stripShellQuotes` helper in `packages/core/src/tools/bash.ts` to strip outer matching quotes (`"` or `'`) before resolving path containment arguments.
  - Rejects arguments containing residual unmatched quotes, preventing quotes from bypassing the read-only whitelist containment check (`cat "/etc/passwd"` now properly prompts for permission instead of auto-allowing).
- **Phase 21.2 Destructive System Directory Wipe Protection**:
  - Expanded `isRootWipe` in `packages/core/src/tools/bash.ts` to block deletions targeting top-level system directories (`/usr`, `/etc`, `/var`, `/dev`, `/boot`, `/lib`, `/lib64`, `/bin`, `/sbin`, `/opt`, `/proc`, `/sys`, `/run`, `/srv`, `/tmp`, `/root`, `/mnt`, `/media`).
  - Protects against commands like `rm -rf /usr` or `rm -rf /etc` in both interactive and auto-approve / headless execution modes.
- **Phase 21.3 Test Runner Flag Injection Guard**:
  - Added pattern sanitization to `argvWithPattern` in `packages/core/src/tools/verifyTests.ts` to reject patterns starting with `-` or containing null bytes `\0`.
  - Prevents model-provided test filter patterns from being parsed as CLI options by test runners (e.g. `pytest`, `cargo test`).

## [0.8.0] — 2026-09-11

### Added

- **Phase 17 Benchmark Evaluation Harness**:
  - 15 diverse benchmark tasks across 6 categories (bugfix, feature addition, refactoring/migration, regression detection, multifile extraction, and repo configuration) stored under `evals/tasks/`.
  - Evaluation runner (`evals/run.ts`, `npm run eval`) with isolated temp repo worktrees, test verification scripts, and cost/token accounting.
  - Deterministic offline mock provider (`createEvalMockProvider`) for instantaneous, zero-cost CI validation (`npm run eval -- --fast --mock`).
- **Phase 18 Provider Certification Suite**:
  - Automated 5-criterion test harness in `@anvil/core` (`packages/core/src/cert/`): streaming text, tool-call round-trips, multi-turn context continuity (3 turns), deterministic error containment (404/invalid model), and rate-limit backoff / circuit-breaker handling.
  - Certified status tracking in model registry (`certified: "live" | "broken" | "untested"`, `certifiedAt`).
  - Interactive `/model` picker badging (`[✅ live]`, `[❌ broken]`, `[⚠ untested]`).
  - CLI `--version` output displaying latest certification timestamp (`anvil 0.8.0 (certified: 2026-09-10)`).
  - Standalone certification CLI `scripts/certify-provider.ts` and shell runner `scripts/certify-all.sh`.
- **Phase 19 Project Memory & Git-Native Workflow**:
  - Persistent, per-project markdown knowledge storage in `.anvil/memory.md` bounded to 32KB (`MAX_MEMORY_BYTES`), with automatic creation of `.anvil/.gitignore`.
  - Injected deterministically into system prompt at session start after project rules: `<base prompt>` → `[rules]` → `[memory]`.
  - New `update_memory` tool allowing the agent to preserve findings, architectural conventions, and directory notes across sessions.
  - Autonomous Goal Engine auto-commit: opt-in setting `autoCommit: true` in `settings.json` automatically creates git milestone commits (`anvil(goal): milestone <id> — <title>`).
  - Git-native TUI commands: `/diff <branch>` (e.g. `/diff main`) for cross-branch unified diffs in `DiffModal`, and `/pr` for creating GitHub pull requests via `gh pr create --fill`.
- **Phase 20 Distribution & CI Pipeline**:
  - Clean `npm publish` readiness with standardized `exports`, `main`, `types`, and `prepublishOnly` scripts across `@anvil/core`, `@anvil/tui`, and `@anvil/cli`.
  - GitHub Actions CI pipeline expanded to gate build, strict typecheck, unit tests, fast evaluation benchmarks, visual regression pixel testing, and provider certification.
  - Automated GitHub Actions release pipeline (`.github/workflows/release.yml`) for publishing to npm and creating GitHub releases on `v*` tags.
  - Support for `npx @anvil/cli` zero-install usage and `npm install -g @anvil/cli`.

## [0.7.0] — 2026-09-09

### Added

- **Phase 0 Visual Regression Matrix Gate**: Full cross-size (80×24, 120×40, 200×60) ×
  cross-theme (dark, highContrast) deterministic visual baseline suite with pixel-level diffing
  via `pixelmatch` (strict 0.1% threshold) across 8 core UI scenarios (48 baselines total).
- New npm workflow scripts: `visual:capture`, `visual:diff`, and `visual:approve`.
- Automated GitHub Actions CI workflow (`.github/workflows/visual-regression.yml`) to gate PRs
  against visual regressions and upload diff artifacts on failure.
- Second CI workflow (`.github/workflows/ci.yml`) running the full monorepo build, strict
  typecheck, and the complete unit test suite on every push/PR — the 290+ unit tests were
  previously unguarded in CI (only the visual matrix was gated).
- `core/scripts/verify-openrouter.ts`: repeatable live smoke test for the OpenRouter
  adapter (free-model sync, streaming completion, tool-call round-trip) against the real
  gateway; key read from `OPENROUTER_API_KEY` or `~/.anvil/credentials.json`, never logged.
- **Orcarouter provider (free-only)**: new OpenAI-compatible adapter for
  `api.orcarouter.ai/v1` alongside OpenRouter. Paid models are auto-hidden by policy:
  the live source reads the public key-less pricing catalog's `is_free_tier` flag
  (`/api/pricing` — the keyed `/v1/models` listing is stale and carries no pricing)
  and drops paid ids before they can reach the registry or picker, and the picker now
  renders only free models (`visibleModels()`), which also declutters OpenRouter's
  paid entries. Free is decided by the flag alone — never `model_ratio: 0` (image
  endpoints ride at zero cost) and never the `-free` suffix (a listing can go stale).
  Both routers auto-sync through the single free-model coordinator (boot, picker,
  and `/sync`), so free-list churn — models going free, paid, or away — updates the
  registry automatically (a retirement demotes to `(Paid)`, never deletes).
  Orcarouter's "No available capacity" (503) errors are treated as retryable
  rate-limit-class failures.
- `core/scripts/verify-orcarouter.ts`: repeatable live smoke test for the Orcarouter
  free tier (key-less public-catalog sync, streaming completion, tool-call round-trip
  against the real gateway, default `z-ai/glm-5.3-flash-free`, overridable via
  `ORCAROUTER_MODEL`); key read from `ORCAROUTER_API_KEY` or
  `~/.anvil/credentials.json`, never logged.
- Expanded model registry with latest frontier models (Claude 3.7 Sonnet, Claude 3.5 Sonnet/Haiku,
  GPT-4o, GPT-4o mini, o3-mini, Gemini 2.0 Flash, Gemini 1.5 Pro/Flash).

### Fixed & Hardened

- **Bounded `read_file`**: reads no longer materialize the whole file before applying the 512 KB
  context cap. Reads are now `open` → `fstat` → bounded read on the same open file handle (the
  pattern already used by checkpoints), removing both a TOCTOU between the size check and the
  read and the unbounded memory spike on huge files. `totalBytes` still reports the true file
  size, so truncation honesty is unchanged and now pinned by a dedicated test.
- **`run_command` preview guard**: the permission-prompt `describe()` path no longer throws when
  handed a malformed input object; it reports `"(malformed input)"` instead.
- **Tunable tool timeouts**: `ANVIL_RUN_COMMAND_TIMEOUT_MS` and `ANVIL_RUN_TEST_TIMEOUT_MS`
  override the built-in command/test timeouts (120 s / 60 s), sanitized and clamped to
  [1 s, 10 min] so a hostile or typo'd value can neither busy-freeze a turn nor park it for an
  hour. Defaults are unchanged, and the "Timed out after … ms" summary reports the resolved value.
- **Compaction fallback without `usage` events**: `lastInputTokens` previously only moved when a
  provider emitted a `usage` event, so a provider that never does silently disabled the reactive
  context-compaction check while history grew. A per-request `sawUsage` flag now falls back to
  `estimateTokens()` on the current history snapshot, biasing conservative (compacting a bit
  early beats an unhandled provider context overflow). Providers that do emit `usage` are unaffected.
- **Auto-save error reporting**: Session persist errors now route cleanly into the TUI transcript
  via `printSystemMessage` instead of writing raw text to `stderr`, preventing terminal screen
  corruption and row coordinate desync.
- **`retainOutput` edge cases**: Correctly preserves `undefined` tool output without failing `JSON.parse`
  or labeling un-truncated results as truncated.
- **Tool execution resilience**: Wrapped tool execution across all orchestrator paths in try/catch
  boundaries to gracefully report errors without crashing the session loop.
- **Context compaction boundary protection**: Added `findCleanCompactionCut()` to avoid splitting
  tool call/result pairs during compaction, preventing provider history rejection.
- **History integrity repair**: Added `HistoryStore.repairUnclosedToolCalls()` to synthesize error
  results for orphaned tool calls after unexpected turn errors, preserving strict role alternation.
- **Session mutation concurrency guards**: Prevented concurrent execution of `switchModel`,
  `popLastUserTurn`, and `clearHistory` while an active turn is in flight.
- **Safe atomic writes**: Added `atomicWriteText()` with `AbortSignal` support across file write and
  edit operations.
- **Sub-agent and input hardening**: Sub-agents inherit project rules in system prompts; multiline
  paste in `InputBar` flattens newlines to spaces; headless mode stdin timeout (30s) and cap (1 MB).
- Fixed unmounted component instances across TUI test suites to eliminate listener leaks.

## [0.6.3] — 2026-09-08

### Fixed

- **`grep` could freeze the whole app irrecoverably** on a catastrophic-
  backtracking regex. Patterns come from the model and run synchronously —
  Esc/cancel cannot interrupt them. Verified: `(a|aa)+$` hangs Node for >6s
  on a 38-character line. Two independent bounds now protect the scan:
  a pre-flight shape check rejects the explosive class (unboundedly-repeated
  groups with alternation or variable-length repetition inside — bounded
  repeats and exact `{n}` folds stay allowed) and each line is tested on its
  first 4 KB, with long-line coverage surfaced honestly in the output.
  The bomb pattern now returns an actionable error in ~1 ms; normal patterns
  are unaffected.
- Lockfile workspace entries resynced (they still said 0.1.0 from an earlier
  release while the packages were at 0.6.x).

### Improved

- Previous wave (same day): the phantom "… N earlier messages above"
  indicator, the scrollback row budget, the adaptive cockpit header (no more
  mid-name "…" truncation), and theme-consistent chrome.
- Version bumped to 0.6.3 across core/tui/cli.

- **Phantom scrollback indicator**: the "… N earlier messages above" line
  counted the newest (bottom-anchored) message as hidden whenever it alone was
  taller than the transcript — a single exchange whose answer fit on screen
  still reported "… 2 earlier messages above". The fold math now counts only
  messages fully above the clip; a message the fold cuts through is partially
  visible and never counted as lost.
- **Scrollback row budget** matched to the real layout (reserve 10, not 12) so
  the indicator and Yoga's actual list height agree.
- **Header truncated the model name mid-word** ("Ollama · Qwen 2.5 Coder
  (Local) [FREE] …" at 100 columns). The cockpit header now measures its own
  deterministic left-column width and budgets the model tag to the exact
  remainder — the right side can never squeeze the left column (which made
  Ink wrap "▲ ANVIL" onto a second row) — and prefers a compact
  `provider · model` tag over a mid-name "…" when space is tight (state and
  pricing already live in the StatusBar).
- Uncommitted TUI polish wave folded in: theme-consistent colors across the
  chrome, styled slash-command menu, and sent-message recall entries for
  command-driven sends.

## [0.6.2] — 2026-09-07

### Fixed

- **Chat content vanishing in native terminals** (the second, final root of
  the line-stacking family): the app frame was exactly `rows` tall, and Ink
  wipes the whole terminal (screen + scrollback + home) whenever rendered
  height >= terminal rows — true on every re-render, i.e. every spinner tick
  (326 full-screen wipes observed in one short session at 236x46). tmux
  absorbs those wipes; a native terminal desyncs — user messages vanished,
  redraws landed on wrong rows. The frame is now one row shorter than the
  terminal, so Ink always uses its stable in-place diff path. Verified in a
  raw pty (no tmux) across 20-46 rows x 80-236 columns: zero wipes, all
  content persists; tmux behavior unchanged.

## [0.6.1] — 2026-09-07

A full chief-engineer audit of the post-0.6.0 tree plus a concurrent TUI
hardening pass. The headline: the "lines stack and interfere" corruption is
fixed at its root, and two real security holes in the command safe-list are
closed.

### Fixed

- **Line stacking (root cause 1 — input)**: when keystrokes arrive batched in
  one read (fast typing, paste, tmux/SSH), the text-input component embedded
  the carriage return into the input value instead of submitting — a raw
  control character in a rendered frame line desyncs terminal row accounting,
  and every later redraw lands on the wrong rows. Input is sanitized and an
  embedded return now submits.
- **Line stacking (root cause 2 — display)**: the transcript could render
  assistant text, tool summaries, and verification output containing raw
  control characters (`\r` progress lines, ANSI escape codes, tabs), which
  Ink's row accounting cannot survive — borders broke and lines overwrote
  each other for the rest of the session. All display sinks now sanitize
  (`sanitizeTerminalText`): last `\r` segment kept (progress-bar semantics),
  escapes stripped, tabs expanded. Verified live with a command printing real
  color/progress/bell bytes.
- **Security**: the read-only command safe-list no longer auto-allows file
  readers pointed outside the project (`cat ~/.ssh/id_rsa` used to run
  unprompted); `~`/`$HOME` arguments fail closed. The destructive-command
  guard de-shells quotes and command substitution, so `rm -rf "$HOME"` and
  `echo $(rm -rf ~)` are refused.
- **Provider replay**: loop-guard notes were written before tool results in
  history — a 400 on OpenAI-family providers and an Anthropic contract
  violation exactly when a model started looping. Results now lead.
- **Headless honesty**: `anvil -p` exited 0 when the turn was cut off by the
  step budget (now exit 2); Ctrl+C reaches the graceful-cancel handler;
  unknown flags fail loudly; `--help` works anywhere; `-p "-42 is the answer"`
  is accepted.
- **Goal engine**: cancelling or erroring on the planning turn aborts the
  mission instead of burning the turn budget; the milestone review accepts
  only the prompted `YES —` verdict shape (hedges fail); failed milestones
  are visible in headless output.
- **Race conditions**: a message queued in the gap between turns could start
  a second concurrent send; typing between mission turns collided with mission
  turns and failed innocent milestones. The busy claim now spans the whole
  drain/mission, queues drain afterwards, and the Mission Deck's detail line
  updates live.
- A reply taller than the transcript pushed the user's message off the top
  and the "… N earlier messages" indicator (rendered inside the clipped
  region) was itself the first row eaten — the turn vanished without a trace.
  The indicator now sits outside the clip and is always visible.
- The status bar could be squeezed to zero rows by an overflowing transcript,
  and measured width in code points instead of terminal cells (wrapping
  `tokens … out` onto a second row); the bar is shrink-proof and the token
  segment truncates to fit.
- Markdown rendering: ordered lists lost their numbers; table rows laid out
  side by side on one physical line; code blocks could fill the whole
  transcript (long blocks now window head+tail with an omission line);
  structural blocks render with blank-line separation; lists render with a
  hanging indent and literal `•` bullets parse as markers.
- Every fixed-height UI zone is width/height-capped: permission diffs, the
  diff and rewind modals (windowed), the mission deck, tool/sub-agent/
  verification card one-liners, and the outer frame clips as a backstop.
- `grep` reported `truncated: false` when the cap was hit inside the last
  scanned file; the cap is enforced per match.
- `estimateTokens` (proactive compaction on resume) ignored images — each now
  counts a 2k-token floor.
- Concurrent writers to the same file raced one temp name in
  `atomicWriteJson` (sequenced suffix; orphan temps cleaned up).
- The model registry was keyed by id only — the same id under two providers
  silently overwrote, curated rows included. Provider-qualified lookup, and
  registration replaces only that provider's row.
- A crashed sub-agent reported an empty success — the reason is captured and
  surfaced.
- `anvil -p` could hang forever on an open-but-silent non-TTY stdin (5s idle
  window, stderr note).
- Files named like `..config` were rejected as path escapes; unknown model
  ids never compacted (32k fallback window); a delegation that changed files
  now triggers auto-verify; an emptied checkpoint ring clears its persisted
  file; `/connect` is escapable; the `/expand` notice no longer duplicates;
  the transcript scrollback estimator counts settled assistant messages
  through the real markdown parser.

### Changed

- CLI boot (chat / headless / goal) shares one selection/MCP/credentials
  path; MCP connection problems are surfaced on stderr in headless and goal
  mode instead of being swallowed silently. `EXCLUDED_DIRS` is a single
  source (union set) shared by grep / list_files / get_outline / workspace
  awareness.
- Workspace dependency pins fixed (v0.6.0 shipped with stale pins that broke
  fresh installs).

## [0.6.0] — 2026-09-06

### Added

- **Cockpit TUI**: the header now shows the repository name, git branch (with
  dirty `*`), ecosystem, package manager, detected test script, and rules
  source; the status bar shows test-suite health (`🧪 green`/`fail`/`running`)
  and the checkpoint counter (`⎌ <n>`).
- **Verification & self-repair cards**: when the closed-loop verification runs
  in the transcript, a `VerificationCard` shows the test command, pass/fail
  state, failure trace, and repair attempts (`Repair attempt 1/2`).
- **Mission Deck HUD**: while a goal is active, a docked panel above the input
  bar shows the goal, its milestones (`✓`/`▶`/`○`/`✗`), live detail notes, and
  the turn budget (`Turn N/10`).
- **Interactive modals**: `/diff` opens a syntax-highlighted diff modal with
  file tabs (`Tab`/`h`/`l`) and scrolling; `/rewind` opens a checkpoint
  timeline with instant rollback on `Enter`.
- **Goal mode (`anvil -g, --goal "<objective>"` / `/goal`)**: Anvil introspects
  the workspace (git state, ecosystem, package manager, test scripts, project
  rules), decomposes the objective into verifiable milestones, executes them
  autonomously with closed-loop test verification, reviews its own work per
  milestone, and reports a debrief. Milestones are marked completed only with
  evidence (clean turn + passing verification + self-review); failed
  milestones are reported as such and do not abort the run.
- **Closed-loop TDD auto-verification & self-repair**: after file mutations,
  Anvil runs the project's test suite; on failure the trace is fed back into
  context for up to 2 self-repair attempts before the turn completes.
- **`verify_tests` tool**: run the detected test runner (npm, cargo, pytest,
  go) with an optional pattern filter. Patterns are passed to the runner as
  literal arguments — never through a shell.
- **Headless mode (`anvil -p "..."` / stdin pipe)**: non-interactive turns
  stream assistant text to `stdout` and diagnostics to `stderr` (pipeable).
  `-y/--yes` auto-approves mutating tools; without it they are refused, so
  unattended runs are safe by default.
- **Project rules discovery**: `.anvil/rules`, `AGENTS.md`, or `.cursorrules`
  (precedence-ordered, 16 KB cap) are injected into the system prompt at
  session start.
- **`get_outline` tool**: token-efficient structural outline (functions,
  classes, interfaces, types, enums, headings) for TypeScript, JavaScript,
  Python, Go, Rust, and Markdown files.

### Fixed

- **Security**: `verify_tests` no longer interpolates its `pattern` argument
  into a shell command. A pattern is now a separate argv element for the
  detected runner, so model-supplied filter text cannot execute arbitrary
  shell commands (confirmed exploitable before the fix).
- **`/goal` in the TUI now runs the real goal engine.** It previously only
  sent a chat prompt with a hardcoded, never-updating mission deck; the deck
  now reflects genuinely evidence-gated milestones (clean turn + passing
  verification + self-review), live turn counts, and an honest debrief —
  including `✗` for milestones that fail review.
- **Closed-loop auto-verification is now enabled in normal chat sessions**
  (TUI and headless). It was implemented but never switched on outside goal
  mode. After file mutations, the detected test runner gates the turn; in
  headless mode verification runs are visible on stderr (`🧪 [verify] …`).
- Goal engine honesty: milestones are no longer marked completed
  unconditionally — completion requires a clean turn, passing verification,
  and a YES from the per-milestone adversarial review. The final critique is
  retried when it comes back empty instead of printing a blank verdict.
  Short single-action goals now plan one milestone instead of the generic
  three-phase plan. Goal mode aborts with a clear message when a mutating
  tool is permission-refused instead of burning the remaining turns.
- Verification events are surfaced in headless output (`🧪 [verify] …` on
  stderr) instead of running silently.
- The cockpit header reports the correct branch for a git repo with no
  commits (previously shown as "no-git").
- Auto-verification only triggers when a mutating tool actually succeeded;
  cancelled batches and errored calls no longer count as mutations.
- Circuit-breaker accounting: one rate-limited request counts as exactly one
  failure; other errors (e.g. unknown-model 404s) no longer open the circuit;
  the backoff counter is no longer reset while the circuit is open.
- The "Rate limited — waiting Ns, retrying automatically…" notice is rewritten
  when the automatic retry also fails, so the transcript no longer implies a
  retry is still pending next to the final error.

### Planned

- Live verification against the seven unit-tested-only providers (blocked on
  API keys — only Gemini and OpenRouter credentials exist)

## [0.5.0] — 2026-09-06

### Added

- **Vision input**: `/image <path>` attaches a png/jpeg/webp/gif (max 5 MB) to
  your next message; the attachment shows in the transcript and travels as a
  native image part through every adapter (Anthropic base64 blocks, OpenAI
  data-URL content parts, Gemini `inlineData`). Models flagged non-vision get
  a warning at attach time.
- **`/retry <text>`**: retry with corrected wording — the previous exchange is
  dropped and your revised message is sent instead of the original.

### Fixed

- Gemini image parts use the `@google/genai` camelCase shape (`inlineData`/
  `mimeType`); the wire-format `inline_data` shape was rejected with
  "required oneof field 'data'". Verified live: the payload now passes API
  validation (failures become quota errors, not format errors).

## [0.4.0] — 2026-09-06

### Added

- **Message queueing**: typing while the agent is busy now queues the message
  (visible as "⏳ N queued" above the input) and sends it automatically when
  the turn settles — instead of bouncing with "cancel first". Slash commands
  keep their busy-guards; the queue belongs to the conversation and clears
  with /clear or /session switches.
- **`/retry`**: drops your last exchange (answer, tool calls and results
  included) and re-sends the request fresh — history and transcript unwind
  together.
- **`/diff`**: reviews every file the session touched as unified diffs
  against their pre-change snapshots (write_file/edit_file edits; deletions
  and creations included), capped for display.

## [0.3.0] — 2026-09-06

### Added

- **Context gauge in the status bar**: `ctx 34%` from the provider's real
  per-turn token counts vs the model's window; turns amber as compaction
  territory (75%) approaches. Hidden for models unknown to the registry.
- **Automatic rate-limit recovery**: a 429 mid-turn waits out the provider's
  retry window (parsed from the message, clamped 1–120s) and retries the
  request once automatically — a notice appears in the transcript, Esc still
  cancels during the wait, and a second 429 surfaces as a normal error.
- **Live sub-agent progress**: delegation cards now show what the sub-agent
  is doing as it happens ("running… read_file (2 calls so far)") instead of
  freezing until the final report.
- **Persistent checkpoints**: `/rewind` history survives app restarts
  (stored per-session under `ANVIL_HOME/checkpoints/`, mode 0600, ring-capped).

### Changed

- `/mcp reconnect` hot-loads newly connected tools into the running session —
  no restart needed. Sub-agents inherit them too; only mid-turn reloads are
  refused (the in-flight batch classified against the old list).

### Deferred to 0.4.0

- Message queueing while a turn is busy; re-run/edit last message
- `/diff` session review (all file changes made this conversation)
- Image/vision input for vision-capable models
- Live verification against the seven unit-tested-only providers

## [0.2.0] — 2026-09-06

The correctness-and-UX release: a full engineering audit plus a hands-on
pass running real models (Gemini, OpenRouter) through every screen.

### Fixed

- **Frame collapse** — the "lines stack and interfere" bug: with content taller
  than the terminal, Ink compressed every UI zone at once, merging turns onto
  shared rows and breaking overlays. The transcript is now a bounded,
  bottom-anchored scrollback window and only the transcript ever shrinks.
- **Terminal resize** — the frame stayed frozen at boot size when the window
  resized or fullscreened; Anvil now re-renders on the TTY resize event.
- **History corruption on cancel** — cancelling mid-tool-batch (open permission
  prompt, running sub-agent) left tool calls without tool results, which
  providers reject on the next turn. Cancelled batches now close with
  synthetic results.
- **First send after resume** could exceed the model's context window;
  compaction now runs proactively on oversized restored sessions.
- `grep` no longer reads oversized files into memory before skipping them.
- Finished `edit_file` cards show `Edited file (+N −M)` instead of the raw
  diff's separator line.

### Changed

- **Read-only command safe-list**: `ls`, `cat`, `git status`, `node --version`
  and similar plain read-only commands run without a permission prompt.
  Anything with shell metacharacters, globs, or mutating subcommands
  (`git push`, `npm run`) still prompts; auto-allows are recorded in the ledger.
- **`/theme` opens an interactive picker** with live preview (arrow to preview,
  Enter applies and persists, Esc restores the prior theme). `/theme <name>`
  still works directly.
- **Model picker type-to-filter**, plus `[FREE]`-tag dedupe on live-synced names.
- **Friendly provider errors**: rate limits (with retry time), auth failures,
  404s, and context overflow render as one actionable line instead of raw
  provider dumps.
- Typing during a busy turn now prints a notice instead of silently dropping
  input; the transcript shows a "… N earlier messages above" indicator when
  scrolled content is clipped; `/session` and `/rewind` lists use short ids and
  relative timestamps; Esc denies the permission prompt.
- Comments trimmed to load-bearing rationale; internal milestone tags removed.

### Added

- `list_files` accepts plain names (`calc` finds `calc.py`) in addition to globs.
- Regression suites for cancellation history repair and proactive compaction;
  tmux-based visual capture harness (`packages/tui/scripts/capture-frames.sh`).

## [0.1.0] — 2026-09-02

Initial release: nine providers with streaming and a model registry, agent
loop with six tools and path containment, interactive permission prompts with
unified diffs, session persistence, context compaction, theming, first-run
onboarding, sub-agent delegation, and MCP (stdio) support.

## [Unreleased]

### Planned

- Verification/eval harness, provider certification, project memory & git-native workflow, distribution (see `docs/ROADMAP.md`).

[Unreleased]: https://github.com/imitravanu/anvil/compare/v0.8.0...HEAD
[0.8.0]: https://github.com/imitravanu/anvil/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/imitravanu/anvil/compare/v0.6.3...v0.7.0
[0.6.3]: https://github.com/imitravanu/anvil/compare/v0.6.2...v0.6.3
[0.6.2]: https://github.com/imitravanu/anvil/compare/v0.6.1...v0.6.2
[0.6.1]: https://github.com/imitravanu/anvil/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/imitravanu/anvil/compare/v0.5.1...v0.6.0
[0.5.0]: https://github.com/imitravanu/anvil/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/imitravanu/anvil/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/imitravanu/anvil/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/imitravanu/anvil/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/imitravanu/anvil/releases/tag/v0.1.0

