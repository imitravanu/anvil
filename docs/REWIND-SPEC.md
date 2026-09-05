# REWIND SPEC — checkpoints + `/rewind` ("undo for file mutations")

> Status: APPROVED (head-of-project decision, 2026-09-05). The implementing
> agent must follow this spec exactly — no improvisation, no reordering, no
> trimming of acceptance criteria.

## 0. Why (product context)

The permission prompt is the ONLY gate for project-local destruction
(`rm -rf .` via `run_command`, or a bad `edit_file` the user waved through).
`docs/HARDENING-RECORD.md` §4 names this the top remaining safety risk. The
fix is checkpoints: snapshot what file tools are about to change, restore on
explicit demand. This is undo, not backup — memory-only, bounded, honest
about what it cannot do.

## 1. Objective

`AgentSession` snapshots `write_file`/`edit_file` targets BEFORE a mutating
batch runs, keeps the last 5 checkpoints in memory, and restores one on the
explicit `/rewind <n>` command — proven by automated tests.

## 2. Non-goals (enforce regardless of temptation)

- NO `run_command` undo. Shell commands cannot be snapshotted; the UX copy
  says so every time (`/rewind` list output + README). No exceptions, no
  half-measures (no command allowlisting for "safe" commands).
- NO persistence across resume. Checkpoints live in session memory; a resumed
  session starts with none and says so honestly. (Persisting file contents
  into session JSON doubles storage and leaks file data into the sessions
  dir — explicitly rejected.)
- NO auto-rewind, NO branching/timelines, NO checkpoint of checkpoint restores
  (a rewind does not itself create a checkpoint — the pre-rewind state is
  gone by explicit user choice; re-running the turn re-creates history).
- NO permission prompt on rewind. The explicit `/rewind <n>` command IS the
  consent. The restore IS ledger-recorded.
- NO new TUI test infra; pure-function tests only (per amended Phase 8 rule).

## 3. Scope

### 3.1 New module `agent/checkpoints.ts` (pure logic + fs, no session)

```ts
export interface FileSnapshot { path: string; content: Buffer | null }
// content null = file did not exist (rewind deletes it)
export interface Checkpoint { id: number; ts: string; files: FileSnapshot[]; skipped: number }

export const CHECKPOINT_KEEP = 5;          // ring size per session
export const CHECKPOINT_FILE_MAX = 512 * 1024; // per-file cap (== tool read/write caps)
export const CHECKPOINT_TOTAL_MAX = 2 * 1024 * 1024; // per-checkpoint byte cap

export function takeSnapshot(projectRoot: string, id: number, paths: string[]): Checkpoint
// (AMENDMENT, P2: id assigned by the caller — the session only bumps its
// sequence when files were actually snapshotted.)
// takeSnapshot resolves each path with resolveWithinRoot; unresolvable paths
// are SKIPPED (counted in `skipped`), never thrown — a hostile path must not
// break the turn it rides in. Files larger than FILE_MAX are skipped too.
export function capCheckpoints(list: Checkpoint[]): Checkpoint[]  // keep last KEEP
export async function restoreCheckpoint(projectRoot, cp): Promise<{ restored: string[]; deleted: string[]; errors: string[] }>
```

### 3.2 Session integration (`agent/session.ts`)

- New per-session state: `checkpoints: Checkpoint[]`, `checkpointSeq = 0`.
  Reset on `clearHistory()`? NO — `/clear` makes a fresh `AgentSession`
  anyway (new object, empty ring). `switchModel` keeps them (same object).
- Snapshot point: in `send()`, when the classified batch `toRun` contains
  ≥1 `write_file`/`edit_file` call (checked by NAME, pre-permission — the
  snapshot must exist even if the user denies half the batch; denied tools
  simply never changed anything, restore is still correct).
  - Collect target `path` strings from call inputs (`typeof input.path ===
    "string"` only; malformed inputs skip).
  - `takeSnapshot` → if `files.length + skipped > 0`, assign id, push,
    `capCheckpoints`, record ledger `checkpoint_created`, yield
    `{ type: "checkpoint", id, files }`.
  - Read-only batches and `run_command`-only batches create NOTHING.
- New event: `{ type: "checkpoint"; id: number; files: number }`.
- Public API:
  ```ts
  getCheckpoints(): CheckpointMeta[];   // metadata view (no contents)
  // (AMENDMENT, P2: ships metadata-only — contents never leave the session.)
  rewind(id: number): Promise<{ ok: boolean; restored: string[]; deleted: string[]; errors: string[]; message: string }>;
  ```
  `rewind` restores via `restoreCheckpoint`, records ledger `rewind`
  (outcome ok/error), and does NOT create a checkpoint.

### 3.3 TUI (thin pass-through)

- `useAgentController.applyEvent`: `checkpoint` → system message
  `Checkpoint #<id>: <n> file(s) snapshotted — /rewind <id> to undo.`
  (`run_command`-only turns get no message — nothing snapshotted.)
- Pure `formatRewindList(checkpoints)` + `formatRewindResult(result)` in
  `tui/src/util/rewind.ts`, with tests. List output ends with the honesty
  line: `Shell commands can't be rewound — only file writes.`
- `/rewind` (no args) lists; `/rewind <n>` restores via a single context
  method `rewind(idText?: string)` — App owns arg parsing, registry stays thin.
- `/help` example + CLI `--help` line + README row.

## 4. Acceptance (FakeProvider + tmp root, deterministic, no network)

- **R1** Turn overwrites existing file → exactly one `checkpoint` event
  (`files: 1`); snapshot holds ORIGINAL bytes; `rewind(id)` restores them;
  ledger contains `checkpoint_created` + `rewind/ok`.
- **R2** Turn creates a new file → `rewind(id)` DELETES it (snapshot null).
- **R3** Read-only turn and `run_command`-only turn → zero `checkpoint`
  events, `getCheckpoints()` unchanged.
- **R4** Six mutating turns → `getCheckpoints()` holds ids 2..6 (KEEP=5,
  oldest dropped).
- **R5** `rewind(999)` → `{ ok: false }`, files untouched, ledger
  `rewind/error`.
- **R6** Batch containing a path-escape `write_file` → snapshot skips it
  (`skipped: 1`), turn proceeds, no throw from checkpoint code.
- **R7** Full regression: all existing tests still green.

## 5. Sequencing (do not reorder)

1. `agent/checkpoints.ts` + pure tests → 2. session state + snapshot point →
   3. `rewind()` + event → 4. TUI passthrough + formatter + tests → 5.
   `/rewind` wiring → 6. gates (`typecheck`, core+tui tests, build,
   `git status` allowlist).

## 6. Gotchas

- Snapshot BEFORE permission prompts (pre-permission, by name) — a denied
  tool changes nothing, so restoring over it is a no-op-correct. Snapshotting
  after approval races the execution it must precede.
- `write_file` with non-string/missing `path` in input: skip, never throw
  (the executor will report the validation error to the model).
- `restoreCheckpoint` re-resolves every path with `resolveWithinRoot` —
  a checkpoint must never become a path-escape vector itself.
- Sub-agent file writes snapshot into the SUB-agent's ring, not the main
  session's (each `AgentSession` owns its ring). `/rewind` in main cannot
  undo sub-agent writes — state this in the list output? NO — too noisy.
  State it here and in the record only. (Future U10 UI may surface it.)

## 7. DECISION LOG

| Decision | Alternatives rejected | Reason | Trade-off |
|---|---|---|---|
| Memory-only, no persist | session-JSON persist | storage doubling + file-data leak into sessions dir | resume loses rewind; honest message covers it |
| Explicit `/rewind n` = consent, no prompt | broker prompt on restore | the typed id IS deliberate consent; prompts on undo punish the safe path | none material |
| Snapshot pre-permission by name | post-approval snapshot | must precede execution it protects; denied tools are no-op-correct | snapshots occasionally unused (all-denied turns) — bounded, fine |
| No run_command undo | "safe command" allowlist | unsound boundary, endless taxonomy | stated honestly in UX copy |
| Ring of 5, 512K/file, 2M total | unlimited / 1-deep | matches tool caps; bounds memory | very long sessions lose old undo — accepted, stated |

## 8. Definition of done

1. R1–R7 tests exist and pass; regression gate green.
2. `git diff --stat` limited to this spec's scope (§9 allowlist in record).
3. TUI changes: event passthrough + formatter + `/rewind` + help/README copy.
4. `docs/REWIND-RECORD.md` written with verification snapshot.
