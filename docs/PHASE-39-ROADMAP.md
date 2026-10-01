# Phase 39 — Audit remediation: make the record honest

> **Version:** v1.12.x
> **Date:** 2026-09-30
> **Author:** Chief Engineer (OpenCode session, owner-approved)
> **Status:** IN PROGRESS — W1–W7 landed (verified against live code
> 2026-10-02); W8 partially landed (E8, G17, G9–G13, G15, F12, F13);
> W8 remainder open (H1, C9–C19, E7/E9, F8, G6).
> **Scope:** [`AUDIT-2026-09-30.md`](AUDIT-2026-09-30.md) recorded 79 findings
> (9 × P1, 29 × P2, 41 × P3) from a full-tree adversarial review and grouped
> them into eight workstreams (its §11). This phase executes them. Every wave
> keeps the full guardian gate green and commits per workstream, here.

## Sequencing

**W1 had to land before Phase 38.5** (the prompt rewrite): a rewrite gated by a
harness that still miscounted budgets (A1) and winners (A2) would repeat Phase
38's founding error. W1 landed 2026-09-30, so **38.5 is unblocked**. W2–W8 are
independent of 38.5.

## W1 — Measurement integrity (COMPLETE, 2026-09-30)

Closes the 38.4 harness's own defects plus the certification default:

| Finding | Fix | Pinned by |
|---|---|---|
| A1 [P1] | `armProfileOverride()` floors only an EXPLICIT arm budget; an unset budget passes the task's own budget through. Before: every A/B run was forced to 4,096 tokens while shipping runs at 8,192 | `experiment.test.ts` (A1 pair), observed end-to-end in `profileSeam.test.ts` |
| A2 [P1] | `assessSignificance` records each reproducible task's winner; a 5-task split (3 baseline / 2 candidate) is reported as a split, not as "unanimous" for the aggregate leader | `significance.test.ts` A2 pair |
| A3 [P2] | `betweenTaskDelayMs` now sleeps between A/B runs; the option was spread into per-task calls whose only consumer is the batch runner | shape mirrors `runAllEvalTasks`; full gate green |
| A5 [P2] | one `matchesTaskFilter` (id OR name, case-insensitive) shared by both eval lanes | `experiment.test.ts` A5 |
| A6 [P2] | NEW `profileSeam.test.ts` mocks `AgentSession` and asserts the RESOLVED session options (budget + prompt), replacing a test that accepted any throw | 4 seam tests |
| B1 [P1] | certification provenance is fail-closed: an omitted `mock` flag records "mock"; only an explicit `mock: false` records "live" (the suite had stamped real registry rows live) | `certify.test.ts` provenance pair |
| G14 [P3] | `hasOwnProperty` guard: `ANVIL_LOG=constructor` can no longer shadow the level map | `logger.test.ts` |

**Mutation receipt:** with the four production files stashed, **10 of 10 new
assertions failed**, each naming its finding (A1 ×3, A2 ×2, A5, A6, B1, G14);
10/10 pass after restore, and the full guardian gate (Steps 0–5, all unit
suites, 25/25 mock evals) is green on the final tree.

**38.4 doc closure (part of G5):** the phase table, section header, status,
CURRENT-FOCUS numbering (harness = 38.4, rewrite = 38.5), the CHANGELOG "rerun
in flight" claim and invented verdict quote, and the `agentProfile.ts` comment
numbering are all corrected in this wave. Stale numeric counts elsewhere in the
docs (G6) are scheduled with W8, not rewritten silently here.

**Recorded open item (AUDIT A4):** the harder task tier 38.4's spec requires —
long horizon, multi-turn, real repo — is NOT authored; `evals/ab.ts` still
points at the 25 saturated short tasks. This is a named gap, not an implied
one: authoring it is W1's remaining tail and doubles as 38.5's measurement
carrier.

## W2 — Trust exits and consent (COMPLETE, 2026-10-01)

Owner-directed wave; both flagged owner decisions were taken here (the exit
contract now; the parser one stays with W4):

| Finding | Fix | Pinned by |
|---|---|---|
| G4 [P1] | New named `EXIT_PERMISSION_DENIED = 4` (following `EXIT_UNVERIFIED = 3`): headless tracks denials in a pure `DenialTracker`; a run ending with a denial that no executed mutation cleared returns 4, not 0. Decision recorded: a distinct code, because CI must tell "blocked" from "broke" (1) and from "unverified" (3). | `headless.test.ts` (refusal → 4; read-only success after denial → 4; tracker unit pair) |
| C2 [P1] | `isSatisfiedVerdict` accepts ANY separator before the hedge word — the engine's own prompted "YES — however …" form is a NO again. `phase22.test.ts` now imports the predicate instead of re-implementing it. | `goalEngine.test.ts`, `phase22.test.ts` |
| C3 [P2] | Cancellation survives into the result: all four cancel paths set `cancelled: true`; the CLI maps cancelled → `EXIT_CANCELLED` (130) on both `goal_completed` and `goal_failed`. | `goalEngine.test.ts` (critique-cancel mission), `terminalRenderer.test.ts` |
| C4 [P2] | A crash is not a cancellation: the subagent runner sets only `failureReason`; `delegate_task` surfaces the real reason and records `outcome: "error"` (mirrors the team adapter). | `subagentProgress.test.ts` (reason lands in history; no cancelled event) |
| C7 [P2] | `autoCommitMilestone` commits with an explicit pathspec — an unrelated pre-staged user change no longer rides into the milestone commit. | `gitUtils.test.ts` (pre-staged fixture stays staged) |
| F1 [P2] | Consent summaries sanitized at the broker handoff; LSP diagnostics sanitized at render. | `broker.test.ts`, `calls.test.tsx` |
| F2 [P2] | InputBar routes every chunk through `sanitizeTerminalText` (CR/CRLF pre-normalized so overwrite semantics never eat input) — tabs/BEL/FF/ANSI cannot reach the value. | `input.test.tsx` |

**Mutation receipt:** before the fix, **17 new assertions failed across 9 test
files** (core 8 / cli 6 / tui 3), each naming its finding; after, the same
suites pass and the full guardian gate is green — Steps 0–5, **1,360 tests**
(131 cli / 895 core / 334 tui), 25/25 mock evals.

## W3 — Gate and infra integrity (COMPLETE, 2026-10-01 — commit d652905)

**§3.4 protected-artifact purpose declaration.** Per AGENTS.md §3.4, this wave
edits protected artifacts — `scripts/verify-gate.mjs`, `.githooks/pre-commit`,
`.github/workflows/live-eval.yml`, `packages/cli/src/__tests__/gate.sentinel.test.ts`,
and `scripts/gate-manifest.json` — and may only land with all three of: (a) this
declaration, (b) the manifest regenerated and the sentinel kept in sync **in the
same commit**, and (c) explicit human review of the protected-path diff. The
declared purposes are exactly the G1/G2/G3 hardening (gate), G7 (hook), G8 (CLI
gate mode), and G16 (workflow) fixes below — nothing else. Each change names its
finding; no other behavior of these files is altered.

| Finding | Fix | Pinned by |
|---|---|---|
| G1 [P1] | The diff scanner (`PATHSPEC`) and the full-tree residual scan (`residualDirs`) now share ONE roots constant that also covers root `scripts/**`, `evals/**`, and `packages/*/scripts/**/*.{ts,mjs}`. The three live hits this blind spot hid are migrated: `scripts/audit-qwen.ts:94,142` → `getErrorMessage`, `packages/tui/scripts/visual-diff.mjs:153` → a named comment (empty catch removed). The gate's own fixture/label strings are exempt by an explicit, documented `SELF_EXEMPT` set (rule regexes live as data inside `verify-gate.mjs`); `evals/tasks/**` (scenario data, pinned RED/GREEN by `fixtureIntegrity.test.ts`) is excluded. | `gate.sentinel.test.ts` behavioral scan over synthetic `scripts/`+`evals/` fixtures; residual fixture asserts the migrated files now scan clean |
| G2 [P1] | The sensor is a probe table (`SENSOR_PROBES`); the pass threshold is the EXACT number of expected violations (was `< 8` of 9, so deleting a rule family passed), a TUI-color probe is added, and the gate fails per-family by identity (not a count). The sentinel extracts `scanLinesForViolations` and asserts ENFORCEMENT behavior per family, not source substrings — `if (false)`-neutering a rule now fails the test too. | `gate.sentinel.test.ts` (per-family behavioral probes) |
| G3a [P2] | The bare-any regex covers the comma position (`Record<string, any>`) in both the diff rule and the residual rule. | `gate.sentinel.test.ts` behavioral probe |
| G3b [P2] | Allowlist suppression matches the violation's FILE PATH exactly (`src/a.ts` no longer suppresses `src/a.tsx`) instead of substring-including against the whole message. | `gate.sentinel.test.ts` (exact-path pair) |
| G3c [P2] | Tamper detection matches `.github/workflows/` as a directory PREFIX, so a NEW workflow file is protected even though the hash manifest can only enumerate the files that exist. | `gate.sentinel.test.ts` |
| G7 [P3] | The pre-commit hook's architecture layer judges only `packages/core/` files (a legal CLI→TUI import no longer fails the hook), honors the gate's test exemption, and covers `*.cjs`. | new `preCommitHook.test.ts` (staged fixture: legal `cli→tui` import passes, `core→tui` still refused) |
| G8 [P3] | `anvil gate --watch` now honors `--staged` (scans staged additions, honest banner) instead of silently scanning the working tree, and its `SIGTERM` handler is live: the global `SIGTERM`/`SIGHUP` handlers defer to an attached runner (mirroring the existing SIGINT guard), so a watch session records its final scan and exits 0 instead of being pre-empted by `process.exit(143)`. **Correction (independent deep dive, 2026-10-01):** the first cut inferred runner ownership from `process.listenerCount(signal) > 1`; a foreign listener (a library, or the test runner) therefore made the global handler wrongly defer — it failed `boot.test.tsx` and, in production, would skip terminal restore + MCP cleanup. Ownership is now asserted explicitly via `claimSignal`/`releaseSignal`/`isSignalClaimed`; a foreign listener no longer suppresses the global handler. | `gate.watch.test.ts` (`watchScan` selection, banner honesty, staged transition label, claim registry incl. foreign-listener case) |
| G16 [P3] | The live-eval workflow no longer interpolates dispatch inputs into the secret-bearing shell block; `provider`/`model` arrive via `env:` and are passed with bash-array quoting. | `gate.sentinel.test.ts` (workflow env passthrough assertion) |

## W4–W8 landing record (verified 2026-10-02)

Landed in commits `a43427e`…`7818815` (2026-10-01, Codebuff sessions) and
verified against live code in the 2026-10-02 record-reconciliation sweep
(PROGRESS.md, same date) — the commits themselves carried no bookkeeping,
which that sweep repaired:

- **W4 — Code intelligence: COMPLETE.** D1a–f landed earlier (7c4aed5). D2 —
  symbol-index walks route failures through named `readDirSafe`/`statSafe`/
  `readFileSafe` helpers (`symbolIndex.ts:13-21`, verified). E3 — the LSP
  post-deadline fallback applies the same timestamp guard as the polling loop
  (`lsp/client.ts:320-322`, verified). E10 — a real `LspStdioClient` test
  against a fake server (`lspclientEdges.test.ts`). **Note:** D1 was the 4th
  lexical patch family for Rust/TS — re-assess the CURRENT-FOCUS tree-sitter
  trigger per the plan below.
- **W5 — Safety: COMPLETE.** E1/E2 landed earlier (04566d9). C5/C6 — the
  guardian returns the scanned body plus a same-field writer, and auto-fix
  only rewrites when `getErrorMessage` is resolvable in the body
  (`guardian/interceptor.ts:80,123-127`, verified). C8 — memory preamble is a
  section (`config/memory.ts:143`, verified). E6 — a failed MCP POST answers
  with a JSON-RPC error correlated by request id (`mcp/transport.ts:661-672`,
  verified). **Recorded gap:** E6 has no dedicated unit test (the SSE harness
  is a heavy HTTP fake) — declared by its own commit, not hidden.
- **W6 — TUI correctness: COMPLETE.** F3 — stable member ids
  (`SINGLE_SUBAGENT_ID = "delegate"`, `subagent.ts`, verified). F5 — the
  cell-width family uses `displayWidth`/`curtailToCells`/`splitByDisplayWidth`
  (`tui/util/format.ts:127-158`, verified). F6 — the side-by-side diff floors
  at the modal's real frame cost. F4/F7/F9/F10/F11 — recorded by their commit
  as applied earlier in the tree; spot-verified present.
- **W7 — Provider/eval accounting: COMPLETE except A8 (deferred).** B3 — both
  streaming adapters emit accumulated usage before the error event
  (`gemini.ts:125`, `openai.ts:111`, verified). B4 — strict price parsing,
  `null`/`""` no longer coerce to $0 (`freeModels.ts:64-104`, verified). A7 —
  A/B arms interleave within each trial (`experiment.ts:177`, verified). B8 —
  synced rows refresh from the live catalog and certify "untested" rather than
  undefined (`freeModels.ts:553`, verified). **A8 is DEFERRED** (needs a
  structured error code from the runner, not a regex tweak) — a named deferral
  with a reason, per its commit.
- **W8 — Slop debt + docs truth: PARTIAL.** Landed: E8 — the four
  `(err as Error)` casts in `grep.ts`/`editFile.ts` are `getErrorMessage`
  (zero raw-error-formatting hits remain in production sources, re-verified by
  grep 2026-10-02); G17 — `scripts/audit-qwen.ts` is live work, closed as
  misclassified with a doc comment; three safe-by-design silent catches carry
  rationale comments (re-aligned to the §2.3 `// intentional:` form in the
  reconciliation sweep). **G9, G13, G15 FIXED 2026-10-02** (OpenCode session):
  G9 — the `--help` slash-command line is DERIVED from the TUI `COMMANDS`
  registry via `cli/src/help.ts` (no literal to drift; parity guard
  `help.test.ts`; fail-first probe: registry 20 vs old literal 15, missing
  `pr, team, plugin, context, copy`). G13 — both evals CLIs fail loud on a
  valueless `--provider`/`--model`/`--filter` and on non-positive-integer
  `--trials` (fail-first probes: `Provider: undefined` banner, `--trials
  banana` → 1; both exit 1 with a named message after); the assertion-script
  timeout is `EVAL_ASSERTION_TIMEOUT_MS` (rule 2.4), not a bare `10_000`.
  G15 — `measure-startup.mjs` p95 uses Type-7 interpolation (fail-first:
  400.0 = the max before, 301.0 after, on a fixed 10-sample probe).
  **G10, G11, G12, F12, F13 FIXED 2026-10-02** (OpenCode session): G10 —
  subcommands resolve at the first positional token, not `argv[0]`
  (`anvil --verbose gate` reaches the gate; `-p gate` stays a prompt;
  fail-first: new test red against the old resolver, 1/19). G11 — with an
  explicit `--prompt`, piped stdin is peeked for `STDIN_CONTEXT_PEEK_MS`
  (150 ms) instead of blocking the full idle window (mechanism receipt:
  5,007 ms → 152 ms on a held-open silent pipe). G12 — gate pathspecs
  double-quoted for cmd.exe (POSIX parity verified by negative control:
  injected slop flagged at `health.ts:58`, exit 1); dead export
  `isAltScreenActive` removed; gate/stdin timeouts are named constants;
  the audit's `index.tsx:235,395` refs verified STALE. F12 — dead exports
  `useTerminalSize`/`SPINNER_FRAMES` removed (§2.8). F13 — remaining
  `eventReducer.ts` catches carry `// intentional:`; the `hooks/toolOutput.ts`
  ref verified STALE. **E9, E8-remainder, E7-bounds FIXED 2026-10-02**
  (OpenCode session): E9 — `list_files` truncation now derives from an
  early-stopped walk, not `length >= MAX_FILES` (fail-first: cap-honesty test
  red against the old walk); `verify_tests` win32 kill routes through
  `planTreeKill` (taskkill `/T /F`), mirroring `run_command` (parity +
  planner tests; no win32 host here — recorded honestly). E8 remainder —
  unused `resolveWithinRoot` import, write-only `opened` set, dead
  `diagnostics()` + interface member (zero callers), and
  `isReadOnlyCommand` fails closed on non-strings (fail-first: red against
  stashed bash.ts). E7 — verifyTests's duplicate timeout bounds now import
  the shared `MIN/MAX_COMMAND_TIMEOUT_MS`. **E7 remainder FIXED 2026-10-02:**
  all flagged literals (grep/outline/readFile/LSP) centralized in
  `config/constants.ts`, values preserved verbatim; behavior-preserving by
  construction, receipt is typecheck + full suite (recorded as such).
  E7 is now fully closed.
  **Still open:** H1 (scanner coverage extension —
  magic constants, non-empty silent catches, dead exports), C9–C19,
  F8, G6 (spot-check 2026-10-02: `ENGINEERING-ROADMAP.md`'s `anvil
  1.1.0` line fixed in the sweep; remaining count drift unverified).

**Owner decisions, not mechanical edits:** homegrown-parser vs tree-sitter
after W4 stands. The headless-denial exit contract was DECIDED in W2: a
dedicated `EXIT_PERMISSION_DENIED = 4`, not a reuse of `1`.
