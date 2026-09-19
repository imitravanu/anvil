# Anvil Stabilization Roadmap — 2026-09 (post-audit)

> **Status:** PARTIALLY COMPLETE — S0, S1.1–S1.4, S2.1, and S2.2 are **done** (2026-09-18,
> each landed test-first with the full `npm run gate` green; checkboxes annotated in place).
> Still open: S1.3 rewind external-edit warning, S2.3, S3–S6.
> **Principle:** No new features until the chain **approved → executed → changed → verified → reported**
> is provably consistent. Every finding below cites the inspected source location; none has
> yet been reproduced with a regression test — Step 0 of each phase is to write that test first.
>
> **Relation to existing docs (per AGENTS.md entry protocol):** `docs/PHASE-21-25-ROADMAP.md`
> and `docs/PHASE-21-25-AUDIT.md` already cover security/bug/perf items (quote bypass 21.1,
> root-wipe gaps 21.2, verify_tests flag injection 21.3, pendingCancel 22.1, malformed-JSON
> `{}` 22.2, ledger/compaction O(n²) 23.2/23.3, provider type-escape casts 24.4, and more).
> This roadmap **does not duplicate those** — execute them from their own docs first.
> Items here are findings from the 2026-09 audit that those docs do not track.

---

## Phase S0 — Workflow precondition (do first)

The working tree currently contains modified protected artifacts
(`.fresh-allowlist.json`, `scripts/verify-gate.mjs`, `scripts/gate-manifest.json`,
`packages/cli/src/__tests__/gate.sentinel.test.ts`). `npm run gate` refuses to run
past Step 1 until these are human-reviewed.

- [x] Human review of the protected-path diff (the gate is working as designed — do **not**
      self-authorize with `--ack-protected-change` without review, do **not** revert blindly).
      *Done: 2026-09-18 deep dive verified zero working-tree diff on all protected artifacts
      (the 2026-09-14 concern no longer applies to the current tree).*
- [x] Commit (with `--no-verify` + regenerated manifest, same commit) or revert the changes.
      *Done: nothing to commit/revert — protected paths are byte-identical to HEAD.*
- [x] Re-run full `npm run gate` and record the result here.
      *Done: all gate steps passed (build, typecheck, tests, mock evals) — re-verified after
      every S1/S2 fix landing.*
- [x] Establish a preserved-exit-status verification habit: `set -o pipefail` (or run commands
      without `tail`/`grep` pipes) when validating gate/typecheck/test runs. Two prior audit
      commands piped output and could not certify underlying exit codes.
      *Done: subsequent validation runs use `;`-separated commands with explicit markers
      (e.g. `echo TSC_DONE`) or exit-code-preserving invocations.*

**Exit criteria:** full gate green on a clean tree; this checkbox annotated with the gate output hash.

---

## Phase S1 — Execution truthfulness (engine correctness)

Goal: the filesystem, the history, the ledger, the checkpoints, and the UI can never disagree.

### S1.1 — Single dispatch decision per tool call (F1, F3)

`agent/session.ts:653-718` adds a guardian-refused call to `toRun` because the dispatch
loop never consults `handled`; the final outcome map silently overrides the execution
result afterward. Session-tool handlers also run before the `p.refused` check
(`session.ts:665` vs `:712`).

- [x] Test first: model emits a guardian-violating `write_file` plus a valid `read_file`
      in one batch → assert the write **never executes** (fs untouched), both tool_results
      exist, ledger shows the refusal.
      *Done: `guardianDispatch.test.ts` (rewritten — the original fixture was auto-fixable
      slop the guardian correctly repairs, so it could never pass; added a non-fixable `as any`
      fixture, mixed-batch isolation, auto-fix happy path, and loop-refused session-tool case).*
- [x] Introduce one explicit per-call classification
      (`"run" | "handled" | "refused" | "invalid"`) produced right after `LoopGuard.classify`
      + guardian interception; all downstream consumers (orchestrator input, history,
      ledger, `turn.mutationsOccurred`, checkpoint commit) read only that classification.
      *Done: implemented as a `guardianBlocked` set consulted by the dispatch loop before
      scheduling (semantically the single-decision contract; the refused call never reaches
      the orchestrator and the outcome map is not overridden after execution).*
- [x] Enforce refusal check **before** the session-tool handler branch.

### S1.2 — Verify the final repair (F4)

`turnVerifier.ts:51` skips verification once `verifyRepairsUsed === maxVerifyRepairs`, so
the last repair is never tested and the turn completes as if fine.

- [x] Test first: `maxVerifyRepairs=1`, mutation fails tests, model repairs → assert a
      **second** verification runs and `turn_complete` carries a verified/failed verdict.
- [x] Split "may run verification" from "may request another repair". Always verify the
      final state; terminate with an explicit `verified | verification_failed | unverified`
      outcome event, and reflect it in the ledger and the TUI `VerificationCard`.
      *Done: `turnVerifier.ts` now always probes the final state; `verification_gave_up` is
      emitted only after a real probe of the final (still-failing) state. Note: the pre-existing
      `autoVerify.test.ts` pinned the old 2-probe semantics — updated to the correct bounded
      3-probe contract (2 repair-requesting + 1 final verdict).*

### S1.3 — Checkpoints reflect reality (F5, F6)

- [x] Test first: cancel mid-batch after one `edit_file` succeeded → assert a checkpoint
      exists covering that file. Today `commitRewindSnapshot` is unreachable on the
      cancellation path (`session.ts:729-733` returns before `:741`).
      *Done: deterministic test — second mutation's permission broker hangs until the
      orchestrator's abort race resolves; first write awaited on disk before cancel.*
- [x] Commit the pending snapshot for completed mutations before returning on cancel.
- [x] Filter checkpoint entries to paths whose calls actually succeeded
      (`session.ts:865-899` commits the whole pre-batch snapshot if *any* call mutated).
      *Done: `commitRewindSnapshot` keeps only succeeded write/edit targets and mints no
      checkpoint when nothing succeeded.*
- [ ] On `/rewind`, warn when a target file's current mtime/hash differs from the
      post-checkpoint state (external edit detected) — restore, but say so.
      *Still open: `restoreCheckpoint` restores unconditionally today.*

### S1.4 — Honest completion statuses (F4 fallout)

- [x] `verification_gave_up` must be a distinct surfaced outcome, not a silent skip.
      *Done 2026-09-18: `terminalRenderer.ts` returns `EXIT_UNVERIFIED` (3) for
      `verification_gave_up`, and every exit code is now a named constant rather than an
      inline literal. The event precedes `turn_complete`, and `headless.ts` returns on the
      first exit code it sees — so the previous `undefined` let `turn_complete`'s 0 win and
      a turn that mutated files and left tests failing exited **0**. Covered by three new
      `terminalRenderer.test.ts` cases (give-up is nonzero; the real headless event order
      exits 3, not 0; a repaired failure still exits 0).*
- [x] Headless exit codes: nonzero for failed and unverified-after-mutation turns
      (verify `terminalRenderer.ts` / `headless.ts` mapping; write the table down here).
      *Done 2026-09-18 — mapping verified against source and tabulated below.*

| Exit | Meaning | Emitted by |
|---|---|---|
| 0 | Turn completed / goal succeeded | `turn_complete`, `goal_completed` (success) |
| 1 | Terminal error / goal failed | `error`, `goal_failed`, `goal_completed` (failure) |
| 2 | Step budget exhausted — task may be incomplete | `budget_exhausted` |
| 3 | Mutated files and verification gave up with tests failing | `verification_gave_up` |
| 130 | Cancelled (SIGINT) | `cancelled` |

**Known limitation (stated, not hidden):** when no test runner is detected,
`resolveTestCommand` returns null and verification is `skipped`, so a mutation in a project
with no tests still exits 0 — there is genuinely nothing to verify. Not treated as a bug;
documented so it is not mistaken for verification coverage.

**Exit criteria:** new integration tests S1.1–S1.3 green; `npm run eval -- --fast --mock` green;
no regression in the 722 existing tests.

---

## Phase S2 — Provider layer correctness

### S2.1 — Anthropic usage translation (F7)

`anthropic.ts:75-82` reads `event.delta.usage`; the SDK exposes message-delta usage at the
event level. The stream is cast via `unknown` to a handwritten interface.

- [x] Fixture test with real SDK event shapes (message_start / message_delta / content blocks).
      *Done: fixtures migrated to the true wire shape (`usage` flat on `message_delta`,
      cumulative), plus cumulative-vs-snapshot and legacy-shape tolerance tests.*
- [x] Type against SDK event types; delete the `as unknown as AsyncIterable<...>` cast.
      *Done: stream cast reduced to a single typed `as` against the real SDK event union.*
- [x] Assert input+output tokens reach `session.lastUsage` and the ledger on every turn.
      *Done: session consumes the `usage` event into `lastUsage`/`lastInputTokens` and ledger
      token attribution (`session.ts` ~834); compaction trigger reads the corrected input count.*

### S2.2 — Partial-stream retry semantics (F8)

`base.ts:42-64` retries on first-event error without closing the abandoned iterator, and
neither retry loop tracks whether deltas were already emitted.

- [x] Retry only before the first observable event (deltas or tool calls) unless an adapter
      declares an explicit restart protocol.
      *Done: `surfaced` flag in `streamCompletion` — catch-path retry only while nothing was
      delivered; deltas are never replayed. (No adapter declares a restart protocol; the
      conservative no-replay rule is global.)*
- [x] Close/return abandoned iterators; make retry backoff abortable (`request.signal`).
      *Done: `iterator.return(undefined)` before first-event-error retry; backoff uses the
      shared `sleepAbortable` helper (hoisted to `core/errors.ts`, now also used by the
      session rate-limit retry), and abort during backoff surfaces a cancellation error
      event instead of hammering the endpoint.*
- [x] Test: error-after-two-text-deltas must not re-deliver those deltas.
      *Done: `DeltaThenThrowProvider` (retry no longer re-delivers) and
      `StalledErrorStreamProvider` (abandoned iterator closed — its `finally` runs — and its
      stale events never surface) in `base.test.ts`.*

### S2.3 — Compaction realism (audit note)

- [ ] Property test: after `applyCompacted`, history has valid role alternation and no
      orphaned tool_call/tool_result pairs (`compaction.ts` + `HistoryStore`).
- [ ] Document (and test) the "single enormous message" boundary stated in the README.

---

## Phase S3 — MCP transport hardening

### S3.1 — Connection budget & cleanup (F9)

`mcp/transport.ts:337-425`: the initial SSE GET is awaited before the endpoint timer is
installed, so the advertised `timeoutMs` does not bound connect time; failed attempts do
not always abort+untrack their controller.

- [ ] One deadline covering connect + endpoint discovery; enforced on the fetch itself
      (compose an AbortSignal).
- [ ] Every failed attempt path aborts the stream, untracks, and finishes the pump.
- [ ] Test: server that never sends `endpoint` fails within `timeoutMs` ± ε with zero
      retained controllers.

### S3.2 — Bounds and destination policy (F10)

- [ ] Bound the transport pump queue (bytes + lines) — overflow fails the transport.
- [ ] Cap SSE frame buffering (per-frame and aggregate).
- [ ] Stream-response reads: enforce size during read, not after `res.text()`
      (`transport.ts:516-517` currently reads fully, then checks).
- [ ] POST-destination policy: validate the discovered `endpoint` (scheme + host) against
      the original server URL before every POST; document redirect behavior.

---

## Phase S4 — Trust boundaries (bash & containment)

### S4.1 — Auto-approval audit (F11)

File-tool containment (physical, symlink-aware) and shell auto-allow (lexical, `pathsInsideRoot`)
are different guarantees; subcommand-keyed classification (`git`/`npm`/`node`…) trusts the
subcommand alone.

> **Update 2026-09-20:** the subcommand alone is no longer trusted — its arguments now get the
> same `pathsInsideRoot` containment the file readers use, and escape flags are refused. The
> paragraph above describes the pre-fix state. Two of the three guarantees are therefore now
> lexical-but-identical; the file tools' symlink-aware PHYSICAL check remains the stronger one.

- [x] Table-test every safe-listed binary × plausible flag combinations; document verdicts.
      *Done: 58-row verdict table in `tools/__tests__/bash.test.ts`, each row carrying its
      basis (`contained` | `inert` | `metadata` | `gated`). Every documented verdict matched
      observed behavior on the first run — including the deliberate `metadata` calls
      (`df /etc`, `which bash`), which expose existence/mount info but can never return file
      bytes.*
- [x] Anything with non-trivial option semantics (`git log -p`, `npm view --json <pkg>`)
      either gets the same physical-path treatment or drops off the safe-list.
      *Done: the subcommand branch now runs `pathsInsideRoot` and refuses escape flags by
      PREFIX (`--no-i…`, `--out…`, `--textc…`, `--ext-d…`) so git's own option abbreviations
      cannot slip past an exact-name check. `git log -p` and `npm view --json <pkg>` keep
      their auto-allow — now with argument containment.*
- [x] Re-word README "Read-only commands don't prompt" to distinguish
      *no-prompt-by-policy* from *provably contained*.
      *Done: README §Safety splits project-contained readers from inert printers and states
      that the containment is lexical — a usability policy, not a sandbox.*

### S2/S1 residue — `isRootWipe` doc

- [x] Mark the destructive-command filter as best-effort defense-in-depth (never a sandbox)
      in `bash.ts` header comment and README §Safety.
      *Done: the `bash.ts` header now reads "BEST-EFFORT PATTERN MATCHING, NOT A SANDBOX" and
      the README §Safety bullet matches it.*

---

## Phase S4 — Tool-level fixes

### S4.2 — edit_file output cap (F12)

`editFile.ts` caps the *source* file (`:50`) but never the replacement size before
diff + write.

- [ ] Test: 10 KB file, `new_str` of 1 MB → clean validation error, no write.
- [ ] Check `MAX_WRITE_BYTES` against `Buffer.byteLength(updated)` before
      `createTwoFilesPatch`; return an `EditValidationError`.

---

## Phase S5 — Guardian scoping (F2)

`guardian/scanner.ts` applies Anvil-repo rules (core-imports, TUI colors, placeholder
markers) to *any* scanned project, with only a test-path exception.

- [ ] Tests: a user project importing anvil's own workspace packages (legitimate for them)
      or containing the placeholder-marker word in a string → not blocked, or blocked only
      under an explicit per-project rules file. (See Phase S2 note below: this exact
      document was blocked by those two rules on 2026-09 — live confirmation of F2.)
- [ ] Gate Anvil-specific rule families behind project config (`AGENTS.md` presence /
      `.fresh-allowlist.json` opt-in), per `docs/guardian/init.ts`'s own provisioning flow.
- [ ] Prefer syntax-aware checks for import rules (cheap: resolve the scanned file's
      package membership first).

### S2 note — live evidence for F2 (recorded 2026-09)

Writing this very file was blocked twice by the native guardian turn interceptor:
rule `no-architecture-breach` fired on a quoted import path inside this markdown, and
`no-placeholder-marker` fired on the placeholder word used in prose. The scanner treats
documentation as code and applies repo-internal conventions to arbitrary file types.
Fixes land in this phase.

---

## Phase S6 — Product truthfulness (docs + UI)

- [ ] README: correct "memory-only" checkpoint claim → persistent ring under `$ANVIL_HOME`
      (`checkpointStore.ts`), and what that means for stored project bytes.
- [ ] `/diff`: surface incomplete-coverage warnings when `baselineByPath` eviction
      (BASELINE_MAX_PATHS/BASELINE_MAX_BYTES) or ring cap (CHECKPOINT_KEEP) narrowed history
      (`session.ts:354-370` contradicts its own "never evicts" comment — fix comment too).
- [ ] TUI: on cancel during a busy turn, keep queued messages but announce they are held
      (or clear them) — today they drain immediately into a new turn (`useAgentController.ts`).
- [ ] Provider certification: mock badges labeled "mock"; live results get timestamped
      artifacts in the README table.
- [ ] Retire the 34,006-LOC figure everywhere — it included `dist/*.d.ts` and excluded TSX;
      recount production sources (`src/**/*.{ts,tsx}` minus tests) and note it here.

---

## Phase S7 — Verification debt (test equity)

File-count gaps ≠ coverage gaps, but the subtlest async logic has the thinnest files:
`mcp/__tests__` (3), `lsp/__tests__` (2), goal/team runners, CLI (6).

- [ ] MCP: transport pump, line-splitter limits, SSE parser, reconnect paths.
- [ ] LSP client: request timeouts, server death, fallback honesty.
- [ ] Goal engine: budget exhaustion classification, milestone failure propagation.
- [ ] Add `c8`/coverage reporting to `npm test` so future audits argue from data.

---

## Execution order & sizing

| Phase | Theme | Est. | Blocks |
|---|---|---|---|
| S0 | Workflow precondition | hours | everything |
| S1 | Execution truthfulness | 3–5 days | release claims |
| S2 | Provider correctness | 2–3 days | certification |
| S3 | MCP hardening | 2–3 days | remote trust |
| S4 | Tool fixes | 0.5 day | — |
| S5 | Guardian scoping | 1–2 days | external users |
| S6 | Product truth | 1 day | trust |
| S7 | Coverage | ongoing | — |

**Definition of done (every phase):** failing-test-first → fix → full typecheck + suite →
mock evals → visual suite → full gate green (after S0) → annotate this file in the same
commit, per the AGENTS.md entry protocol.
