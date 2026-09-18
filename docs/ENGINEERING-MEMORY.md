# Anvil engineering memory

## Snapshot and confidence

- Review date: 2026-09-18 (session date supplied by the user).
- Workspace: `/home/mitravanu/Projects/anvil`; inspected HEAD: `f7dedef`.
- Package manifests report `1.0.0`. HEAD and the working tree differ substantially: 71 tracked files were modified at entry, with numerous untracked Phase 25 and UI additions. These are pre-existing user changes, not this review's implementation.
- This is a code-backed architecture and critical-path review, not a claim that every line has been audited. Core session/dispatch/verification, CLI boot, provider contracts, storage, permission broker, delegation, and important UI/integration paths were inspected. Some large-file reads were truncated; ancillary modules and tests were indexed or sampled. Reopen precise functions before changing them.
- Retention is this file, not a promise of permanent model memory. Future sessions should read this document and recheck Git state before relying on it.
- No runtime credentials, personal conversation files, or external provider services were inspected.

## Engineering protocol

Read root `AGENTS.md` before edits. Consult `PHASE-21-25-ROADMAP.md`, `ANTI-SLOP-GATE-PLAN.md`, and the pre-execution audit for roadmap work. Live code overrides historical phase status and line references. Declare file ownership and avoid concurrent edits.

Core must not depend on TUI/CLI. Build in order: core → TUI → CLI; downstream packages resolve built `dist` artifacts. Use existing error helpers, centralized limits, and theme tokens. Do not edit protected gate artifacts or acknowledge their review on the user's behalf.

The old complete roadmap mixes versions and historical tool/test counts. The post-audit `STABILIZATION-ROADMAP-2026-09.md` is a proposed stabilization backlog, not evidence its items are fixed. `DW-4-PROGRESS.md` explicitly defers dashboard/panes, floating overlays, mouse, and live terminal-background probing. Do not advertise those as shipped.

## Repository map

TypeScript ESM, Node >=20, npm workspaces; React 18/Ink 5 UI; Vitest tests; esbuild bundles the CLI. At review, source inventory excluding test/visual directories contains 96 core, 73 TUI, and 7 CLI TypeScript/TSX files. There are 69 core, 40 TUI, and 6 CLI test files, including TUI visual tests.

| Area | Ownership / key entry points |
| --- | --- |
| `packages/cli/src/index.tsx` | Argument routing, onboarding, boot configuration, providers, MCP/plugins, chat/headless/goal wiring, process cleanup |
| `packages/cli/src/headless.ts` | Bounded piped input, noninteractive broker, one-turn streaming and SIGINT handling |
| `packages/cli/src/goalRunner.ts` | Headless mission wrapper and exit behavior |
| `packages/cli/src/terminalRenderer.ts` | Agent/goal events → stdout/stderr and exit codes |
| `packages/cli/src/altScreen.ts` | Idempotent alternate-screen entry/exit with TTY checks and opt-out |
| `packages/core/src/agent/session.ts` | Central agent state machine; composition root for history, tools, verification, rewind, delegation |
| `packages/core/src/agent/orchestrator.ts` | Permission-gated execution and serial/concurrent batching |
| `packages/core/src/agent/historyStore.ts` | History assembly, tool-result ordering and repair, retry/clear/compaction operations |
| `packages/core/src/agent/turnState.ts`, `loopGuard.ts`, `canonical.ts` | Per-turn budgets and stable-input repeat detection |
| `packages/core/src/agent/goal/` | Workspace awareness, planning, milestone execution, review, critique and optional commits |
| `packages/core/src/agent/subagent.ts`, `team/` | Child sessions, bounded reports, shared permissions/filesystem, team coordination |
| `packages/core/src/providers/` | Vendor translation, shared stream events, model registry, live-model sync/cache/health |
| `packages/core/src/tools/` | Built-in definitions/executors, containment, shell/tests, outline, session tools, MCP adapter |
| `packages/core/src/config/` | Credentials/settings/provider selection, rules, project memory, MCP config, limits |
| `packages/core/src/session/`, `agent/checkpoint*` | Conversation persistence and separate rewind persistence |
| `packages/core/src/mcp/`, `lsp/`, `plugins/`, `guardian/` | External tools, code intelligence, local command plugins, native hygiene checks |
| `packages/core/src/eval/`, `cert/`, root `evals/`, `scripts/` | Agent task assertions, provider certification and quality gate |
| `packages/tui/src/components/App.tsx` | UI composition and active session/provider/model ownership |
| `packages/tui/src/hooks/` | Stream consumption, queue, display reduction, session commands, terminal/theme state |
| `packages/tui/src/permission/TuiPermissionBroker.ts` | Queued approvals and session-only grants |
| `packages/tui/src/commands/` | Slash-command registry and domain handlers |
| `packages/tui/src/theme/`, `diff/`, `markdown/`, `util/` | Presentation primitives, formatting, bounded transcript and terminal helpers |

## Execution trace

1. CLI handles help/version/config/native gate/init, resolves flags and piped input, then chooses chat, headless, or goal mode. First-run provider setup needs a TTY.
2. Shared boot restores cached models, loads credentials/settings, resolves provider/model selection, constructs providers, connects configured MCP servers unless disabled, and loads local plugins.
3. Session tools combine the 15 built-ins with plugin and MCP definitions. External executors are registered through the core registry. Chat and ordinary headless prompts add plugin text to the base prompt before project rules/memory.
4. `AgentSession.send()` rejects overlapping sends, appends user input/images, creates an AbortController and fresh TurnState, applies pending cancellation, enforces the inner-iteration budget and conditionally compacts.
5. Provider output becomes text, tool-call, usage, error and end events. Tool-argument deltas are cumulative: consumers overwrite rather than append them. Opaque provider metadata must survive history replay, particularly Gemini thought signatures.
6. Assistant output enters HistoryStore. On a tool-use turn, LoopGuard classifies calls; Guardian examines pending file content; session-specific plan/delegation handlers run; remaining calls go to ToolOrchestrator.
7. Any declared mutating/unknown call makes a batch serial. All-read-only batches use Promise.all and emit results in declared order, not completion order. Shell safe-list exceptions still run in the serial path.
8. Mutating calls request approval after a preview. Denial is an error result, not successful execution. The broker attaches/detaches cancellation listeners and denies on a broker failure.
9. File snapshots are taken before execution; successful covered mutations commit a checkpoint. Outcomes update mutation tracking and tool-result history. The provider then receives the next request.
10. On a non-tool end, auto-verification can run detected tests and inject repair prompts. Completion, cancellation, budgets and errors are distinct events, although some consumers collapse outcomes too aggressively (findings below).

## State ownership and invariants

- **Session:** provider/model, conversation, plan, ledger, latest usage, checkpoint ring, bounded review baseline, latest team report. Model/tool changes and history mutation reject while sending.
- **TurnState:** iteration count, repeat streaks, delegation count, verification repairs, mutation flag, compaction attempt and rate-limit retry. Fresh per send.
- **HistoryStore:** protocol order matters. Tool results must match declared assistant call IDs, including refused/cancelled calls. Avoid mutating copied history or reordering exchanges incidentally.
- **Provider changes:** clear conversation because tool metadata is vendor-specific. Same-provider model switching preserves history.
- **Cancellation:** cooperative, not rollback. Shell/MCP/plugin effects are not rewindable. Do not equate an aborted request with no filesystem changes.
- **Permissions:** "always allow" is per tool name, in memory. New/resumed/cleared trust contexts clear grants; they are not restored from session JSON.
- **Extensions:** external executors are process-global prefix registrations; first registration for a prefix wins. Watch lifecycle and multi-session ownership when refreshing integrations.

## Tools and trust boundaries

15 built-ins: read_file, write_file, edit_file, list_files, grep, run_command, get_outline, verify_tests, update_plan, delegate_task, update_memory, goto_definition, find_references, get_hover, get_diagnostics.

File tools use `resolveWithinRoot`, checking lexical containment and physical containment through the deepest existing ancestor. This is not an OS sandbox and does not eliminate concurrent check/use races. Shell policy is separate; approval authorizes host process execution, not confinement.

`write_file` caps new content and preserves existing permission bits. `edit_file` requires a unique literal old substring and computes a real unified diff; preview and execution recompute separately. Review permissions, final-size bounds, and concurrent edits before treating the preview as an immutable execution contract.

`verify_tests` is declared nonmutating but runs repository code. Auto-verification also runs outside ordinary mutating-tool approval. This is a trust assumption about the project, not proof tests cannot write or use the network.

MCP supports stdio and SSE. Tools are namespaced and generally mutating unless the server declares read-only. That annotation is trust supplied by the server. MCP config is under ANVIL_HOME; servers receive arguments, including any source text supplied by the model.

Local plugins load manifests from ANVIL_HOME/plugins and register command-backed tools plus prompt additions. They are not this assistant's ChatGPT plugins. Command templates run through a shell; replacement-function interpolation avoids JavaScript replacement-token corruption but is not shell isolation or argument escaping.

LSP detects installed language servers, caches clients, opens documents and requests intelligence; fallback paths exist. Diagnostics fallback launches local tsc. Real language-server interoperability was not exercised in this review.

Guardian is a regex-based hygiene layer, not a complete parser or general security sandbox. Its auto-fix rewrites error formatting text; do not assume that also adds needed imports or establishes semantic correctness.

## Persistence and context

- `anvilHome()` lazily honors ANVIL_HOME, defaulting to ~/.anvil. Credentials, settings, sessions, checkpoints, model cache and MCP/plugin data belong there.
- Conversations persist through `toStoredSession` and session/store. They include plan and ledger, not permission grants. The TUI saves after settled turns, including queued turns.
- Checkpoints now persist separately; comments/README still contain memory-only language. Ring eviction and process restart can reduce review-baseline coverage. Parent sessions merge child checkpoints.
- Atomic writers use same-directory temp files and rename. Callers choose file modes and recovery policy; "atomic" does not mean fully durable, access-restricted, or conflict-free in every call site.
- Rules priority is .anvil/rules, then AGENTS.md, then .cursorrules, selecting the first usable root file. This is not recursive AGENTS discovery. Rules cap at 16 KiB.
- Project memory is .anvil/memory.md, bounded to 32 KiB with newest-entry retention. This review deliberately uses a normal documentation file rather than altering the agent's injected project prompt.
- Compaction uses prior measured usage or a resume estimate, retains recent messages, attempts clean tool-exchange cuts, summarizes older material, and can selectively retain relevant older messages. Summarizer input reduces tool payloads to text markers. Estimates are heuristic, not exact tokenization.
- Selective retention needs exchange-level validation: the clean cut protects the old/recent boundary, but selecting individual older messages may separate call/result pairs or create role-order problems.

## Goals, delegation and UI

Goals analyze the workspace, decompose milestones, run task/review turns, and produce a critic/debrief result. Optional auto-commit is off by default and intended to use session-touched paths, with permission. Self-review is model judgment; test status and terminal outcomes must still be authoritative.

Child sessions have independent histories but share the project filesystem, provider and permission broker. Delegation is depth-limited; progress/report/usage/checkpoints return to the parent. Teams support parallel, pipeline and review strategies; they are not separate working-tree isolation.

The TUI maintains a display projection distinct from provider history. `useAgentController` buffers text on a roughly 16 ms timer, flushes before nontext events, routes events through eventReducer, caps display state, and queues user messages while busy. App composes header, transcript, status/input, mission deck and overlays. Session replacement reseeds display history and clears approvals.

Commands cover help, clear, model, sync, session, image, connect, ledger, expand, retry, diff, pr, rewind, mcp, theme, goal, team status, plugin list, context and copy. Presentation includes semantic/custom themes, adaptive width, side-by-side diffs, code highlighting, context gauge, real-usage sparkline, alternate screen, notifications and OSC 52 clipboard.

## Findings to verify before implementation

These are static code findings, not newly reproduced regressions or authorization to patch. Several overlap the existing stabilization roadmap; reuse it rather than creating competing work streams.

1. **Dispatch consistency — highest priority.** `agent/session.ts:617` stores Guardian refusals in `handled`, but the later dispatch loop at `:665`–`:717` does not skip handled calls before adding ordinary tools to `toRun`. Refusal reporting and actual execution can diverge. Likewise session-tool handling precedes the `p.refused` check. Establish one authoritative dispatch decision consumed by execution, history, ledger and checkpoints.
2. **Final repair verification.** `agent/turnVerifier.ts:51` gates test execution on remaining repair attempts, so reaching the repair limit skips verifying the final edit. Session completion continues after gave_up. Test terminal status end-to-end rather than treating turn_complete as verified success.
3. **Cancelled mutations and rewind.** `agent/session.ts:729` returns on cancellation before committing the pending checkpoint at `:742`. Completed effects earlier in the batch may lack the intended undo entry. Serial and concurrent post-abort event policies also differ; define completed-versus-observed semantics before changing them.
4. **Team semantics.** `tools/delegateTask.ts:115` receives but does not use `_budget` when creating child runs. `agent/team/runner.ts:55` executes review alongside the worker rather than after a report handoff. Budget split tests alone do not prove runtime budget enforcement or meaningful review.
5. **Goal verification recovery.** `agent/goal/goalEngine.ts:423` sets verificationFailed on failure without clearing it after a later pass in that turn; a successful repair may still be classified as failed. Compare the TUI mission adapter as well.
6. **Provider malformed arguments.** `providers/streaming.ts:76` converts invalid tool JSON to {}, while the session/executor have explicit malformed-input handling. This loses error provenance and can matter for tools with optional arguments.
7. **Mode parity.** Shared boot gathers plugin prompts, but `bootGoal`/GoalHeadlessOptions pass tool definitions without passing those prompts. Validate intended chat/headless/goal equivalence.
8. **Resource/trust follow-up.** Review MCP queue/frame bounds, process cancellation, secret-bearing storage modes, and physical-path versus shell-policy guarantees through the existing stabilization backlog. No exploit reproduction was performed.

## Verification evidence

- Existing agent tests: `npm run test -w @anvil/core -- src/agent` → **26 files, 152 tests passed** after approved execution outside the sandbox. The first sandbox run had 150 passes and two EPERM subprocess failures; those were environment failures, not established application defects.
- `npm run gate` → Step 0 and 0.5 passed; outside the sandbox, Step 1 refused pre-existing changes to .fresh-allowlist.json, gate.sentinel.test.ts, gate-manifest.json and verify-gate.mjs pending explicit human review. No acknowledgement/bypass was supplied. Build, typecheck, all-workspace tests and mock evals were therefore not reached by this gate run.
- Exploratory cancellation test edits during the review were removed; orchestrator.ts and orchestrator.test.ts have no review diff. Their exploratory runs are not counted as retained regression coverage.
- No live providers, live MCP/LSP integration, visual capture, publish, or full release validation was run. Passing agent tests does not certify those surfaces.

## Next-session starting point

Read this file, root AGENTS.md, Git status and the relevant progress document. Resolve the protected-file review workflow with the human first. Then prioritize the approved → executed → changed → verified → reported chain: dispatch decisions, final verification, cancellation/checkpoint accounting, and extension integration tests. Only then expand UI or headline capabilities. Keep new regression tests deterministic and local; do not modify provider credentials or run paid certification implicitly.
