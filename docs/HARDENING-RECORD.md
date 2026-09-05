# HARDENING RECORD — safety + truthfulness slice (2026-09-05)

> Status: IMPLEMENTED + VERIFIED (gates in §5). This record is the single
> source of truth for this slice. It follows the repo's record conventions
> (`PHASE-8-PROGRESS.md`, `PRODUCT-POLISH-RECORD.md`): verified facts, exact
> file lists, decisions with rejected alternatives, and the verification
> commands that must be re-run before any "done" claim.

## 0. SCOPE — what this slice does and does not do

IN: three independent hardening items + one UI-truth item, each with tests.
OUT (deliberately deferred): U5/U6/U8/U9, U10 rich sub-agent UI, Phase 10 MCP,
per-turn auto-summary, vision pass-through, checkpoint/rewind. See §6.

1. **ANVIL_HOME unification** — credentials, settings, sessions now honor
   `ANVIL_HOME` like the models cache already did.
2. **Destructive-command guard** — `run_command` refuses filesystem-destroying
   patterns without spawning.
3. **Non-consecutive loop detection** — advisory `loop_detected` for
   A-B-A-B-A ping-pong; refusal stays consecutive-only.
4. **`/ledger` command (U7)** — the Phase 8 ledger becomes visible.

## 1. CHANGES (exact file list — `git status` must show only these + docs)

```
MODIFIED:
  packages/core/src/config/index.ts            # lazy anvilHome(), paths via ANVIL_HOME
  packages/core/src/config/__tests__/config.test.ts  # +2 relocation tests
  packages/core/src/session/store.ts           # SESSIONS_DIR() honors ANVIL_HOME
  packages/core/src/tools/bash.ts              # isBlockedCommand() + execute gate
  packages/core/src/tools/__tests__/bash.test.ts     # +5 guard tests
  packages/core/src/agent/session.ts           # totalCounts + repeatWarn (warn-only)
  packages/core/src/agent/__tests__/phase8.test.ts   # +1 ping-pong test
  packages/tui/src/util/ledger.ts              # NEW (pure formatLedger)
  packages/tui/src/util/__tests__/ledger.test.ts     # NEW (+3 tests)
  packages/tui/src/commands/types.ts           # +showLedger
  packages/tui/src/commands/registry.ts        # +/ledger + /help example
  packages/tui/src/components/App.tsx          # showLedger wiring
  packages/cli/src/index.tsx                   # --help lists /ledger + ANVIL_HOME
  README.md                                    # /ledger row, guard + ANVIL_HOME notes
  docs/UI-ROADMAP.md                           # U7 marked done (partial: no auto-summary)
NEW DOCS:
  docs/PHASE-9-PROGRESS.md                     # retrospective acceptance record
  docs/HARDENING-RECORD.md                     # this file
```

## 2. DESIGN DETAILS

### 2.1 ANVIL_HOME (`config/index.ts`, `session/store.ts`)
- `anvilHome()` resolves lazily per call (env may be set after import) —
  same pattern as `providers/cache.ts:8-12`. Unset → `~/.anvil` (zero
  behavior change for existing installs).
- Default parameter values (`dir = SESSIONS_DIR()`) evaluate per call, so
  they stay lazy. Explicit `dir` overrides still win (tests unaffected).
- New export `anvilHome` from `@anvil/core` — no name collision (cache's
  helper is module-private).

### 2.2 Destructive-command guard (`tools/bash.ts`)
- `isBlockedCommand(cmd): string | null` — pure, unit-tested. Returns the
  reason or null. `execute` checks it BEFORE `spawn` and returns an `isError`
  tool_result; nothing spawns, no side effects (proven by test: marker file
  never created).
- Whole-command checks (fork bomb — the segment splitter would shred it)
  run on the full string; segment checks (`&&`/`;`/`|`-split) run per piece
  so `npm run build && rm -rf ~` is still caught.
- Blocked: recursive+force `rm` of `/`, `/*`, `~`, `$HOME` (short, split, and
  `--long` flag forms); fork bomb; `mkfs`; `dd … of=/dev/…`; `> /dev/sdX`;
  recursive `chmod /`. Allowed: `rm -rf ./build`, `rm file`, `dd` without a
  `/dev` target — the permission prompt remains the gate for those.
- Rejected alternative: block ALL `rm -rf` — breaks legitimate build-clean
  flows and trains users to always-allow. The list stays tight on purpose;
  widen only with a test per pattern.

### 2.3 Non-consecutive loop guard (`agent/session.ts`)
- Per-turn `totalCounts` alongside the existing streak state. 3rd TOTAL
  occurrence with other calls in between → one advisory `loop_detected` +
  turn note ("…with other calls in between…"), still executes.
- Invariants preserving Phase 8 acceptance: refusal ONLY on consecutive
  streak ≥ 4 (A4); at most one `loop_detected` per turn (`loopNotified`
  shared with the consecutive path); consecutive 3rd never double-fires
  (`!loopWarn && toolStreak < 3` conditions). A3/A4 tests unmodified, green.

### 2.4 `/ledger` (`tui/src/util/ledger.ts`, `commands/registry.ts`, `App.tsx`)
- `formatLedger(entries)` — pure: event count by outcome, per-tool counts,
  summed measured tokens (labeled measured, per-entry — record, never
  predict), last 15 rows with omission notice. Empty ledger says so honestly.
- Command is read-only (`session.getRunLedger()`), never blocked while busy?
  — actually slash dispatch already handles busy policy; ledger print is
  instant and side-effect-free. Per-turn auto-summary (second half of U7)
  stays open.

## 3. AUDIT CORRECTIONS (things I flagged, then verified as NOT bugs)

1. **Sub-agent tokens excluded from compaction estimate** — CORRECT AS-IS.
   Sub-agents run in a fresh context; only the capped report (≤8000 chars)
   enters main history, and that IS measured by later main `usage` events.
   Cost visibility flows separately (`subagent_finished` → StatusBar totals
   in `useAgentController.ts:205-217`). No change made.
2. **`supportsVision` registry flag with text-only TUI** — dead flag,
   confirmed. Left untouched (widening to vision I/O is a capability phase,
   not hardening). Recommend either wiring or dropping in a future phase.

## 4. REMAINING RISKS (not introduced here, still open)

- Permission prompt is the only gate for project-local destruction
  (`rm -rf .` with Allow). Mitigation path: checkpoint snapshots + `/rewind`
  (no spec yet).
- Single-message context overflow bypasses reactive compaction (by design,
  documented in `compaction.ts:22-27`).
- OpenRouter-only free-model source; 10-min TTL can miss price flips
  (`/sync` forces refresh).

## 5. VERIFICATION (run exactly, in order)

```bash
cd /home/mitravanu/Projects/anvil
npm run build -w @anvil/core   # core dist first — tui/cli compile against it
npm run typecheck               # 0 errors, all 3 packages
npm test -w @anvil/core         # 130/130
npm test -w @anvil/tui          # 20/20
npm run build                   # esbuild bundle OK
git status --porcelain           # only §1 files
```

Result on 2026-09-05: ALL GREEN (core 130/130 across 20 files, tui 20/20
across 4 files, typecheck 0 errors, bundle 6.1mb built).

## 6. SUGGESTED NEXT SLICES (client picks order)

- N1: U5+U6 (richer diffs + expandable tool output) — the other half of
  "trust moment" UI alongside /ledger.
- N2: Checkpoint `/rewind` spec + build — the real fix for project-local
  destruction risk.
- N3: Phase 10 MCP spec (no spec file exists yet) — use `AgentOptions.tools`
  seam + `FreeModelSource`-style source interface pattern.
