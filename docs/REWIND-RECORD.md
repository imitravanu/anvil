# REWIND RECORD — checkpoints + `/rewind` (2026-09-05)

> Status: IMPLEMENTED + VERIFIED (gates in §4). Single source of truth for
> this slice. Spec: `docs/REWIND-SPEC.md` (approved head-of-project decision).
> This was the top remaining safety risk in `docs/HARDENING-RECORD.md` §4 —
> project-local destruction behind one Allow now has undo.

## 1. CHANGES (exact file list)

```
NEW:
  docs/REWIND-SPEC.md                              # approved spec (R1–R7)
  docs/REWIND-RECORD.md                            # this file
  packages/core/src/agent/checkpoints.ts           # takeSnapshot/capCheckpoints/restoreCheckpoint
  packages/core/src/agent/__tests__/rewind.test.ts # +8 tests (R1–R6 + 2 pure)
  packages/tui/src/util/rewind.ts                  # formatRewindList/formatRewindResult
  packages/tui/src/util/__tests__/rewind.test.ts   # +3 tests
MODIFIED:
  packages/core/src/agent/index.ts                 # re-export checkpoints module
  packages/core/src/agent/types.ts                 # +checkpoint AgentEvent
  packages/core/src/agent/session.ts               # ring state, snapshot point, rewind()
  packages/tui/src/hooks/useAgentController.ts     # checkpoint → system message
  packages/tui/src/commands/types.ts               # +rewind(idText?)
  packages/tui/src/commands/registry.ts            # +/rewind + /help example
  packages/tui/src/components/App.tsx              # rewind impl (list/restore/persist)
  packages/cli/src/index.tsx                       # --help lists /rewind
  README.md                                        # /rewind row + snapshot safety note
```

No new runtime dependencies. No permission-broker changes. No session-file
format changes (checkpoints are memory-only by spec design).

## 2. ACCEPTANCE SCORECARD (vs `docs/REWIND-SPEC.md` §4)

| # | Criterion | Result |
|---|---|---|
| R1 | Overwrite snapshotted, rewind restores original bytes, ledger has checkpoint_created + rewind/ok | ✅ PASS |
| R2 | Created file deleted by rewind (null snapshot) | ✅ PASS |
| R3 | Read-only and run_command-only turns snapshot nothing | ✅ PASS |
| R4 | Ring keeps last 5 (ids 2..6 after six mutating turns); rewind(6) restores pre-last-write bytes | ✅ PASS |
| R5 | Unknown id fails cleanly, files untouched, ledger rewind/error | ✅ PASS |
| R6 | Path-escape target skipped (not thrown), turn proceeds, escape file never created | ✅ PASS |
| R7 | Full regression green | ✅ PASS (§4) |

## 3. DECISIONS (beyond the spec log — implementation-level)

| Decision | Reason |
|---|---|
| Snapshot matched by tool NAME pre-permission | Must precede execution; denied tools are no-op-correct on restore |
| Empty snapshot (all targets skipped) records nothing, burns no id | A checkpoint you can't rewind to is noise; R6 proves the skip path instead |
| `/rewind` blocked while busy (like `/clear`, `/model`) | Restoring files mid-turn races the running batch |
| `persist()` after restore | Ledger gains the `rewind` entry — the audit trail survives even though file contents don't persist |
| Sub-agent writes land in the SUB-agent's ring | Each `AgentSession` owns its ring (spec §6); main `/rewind` can't undo them — stated, not surfaced in UI copy (noise) |

## 4. VERIFICATION

```bash
cd /home/mitravanu/Projects/anvil
npm run build -w @anvil/core
npm run typecheck               # 0 errors, all 3 packages
npm test -w @anvil/core         # 138/138 across 21 files
npm test -w @anvil/tui          # 34/34 across 7 files
npm run build                   # esbuild bundle OK
git status --porcelain           # only §1 files
```

Result on 2026-09-05: ALL GREEN.

## 5. WHAT THIS DOES NOT DO (honest boundaries, also in UX copy)

- Shell commands can't be rewound — `/rewind` list output says so every time.
- Resume starts with zero checkpoints (memory-only); the empty-list message
  says file writes snapshot automatically going forward.
- No checkpoint of a restore (re-running the turn re-creates history).
- 5-deep ring, 512 KiB/file, 2 MiB/checkpoint — very long sessions lose old
  undo. Accepted per spec §7.

## 6. NEXT (head-of-project sequencing, unchanged)

1. U8/U9 to close mid-term UI. 2. Phase 10 MCP spec (no spec file exists;
   use the `AgentOptions.tools` seam). 3. Report R-indicators: if users hit
   "skipped" often, revisit caps before widening them.
