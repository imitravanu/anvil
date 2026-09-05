# P1 RECORD — review robustness program (2026-09-05)

> Status: IMPLEMENTED + VERIFIED (gates in §8). Executes the P1 list from
> `docs/CODE-REVIEW-RECORD.md` §5 (plus the P0 tail: this record covers what
> the P0 slice deferred only by ordering). Findings below reference that
> doc's §1–§2 numbers.

## 1. P1-1 — TUI STATE HONESTY

- `usage` resets on session change (StatusBar no longer shows the previous
  session's spend after `/clear`/new/resume).
- `cancelled` is now a first-class `DisplayToolCall` status (dim `○`), and
  the `cancelled`/`error` event handlers settle stranded `running` calls
  instead of leaving spinners forever.
- `MessageList` states hidden history (`… N earlier messages hidden`).
- `sentHistory` capped at 100, transcript state at 1000 (truth lives in the
  session file + ledger).
- `rewind()`/`reconnect()` promises got `.catch` reporters.
- +1 render test (cancelled card).

## 2. P1-2 — DIFF + BROKER

- `ColorizedDiff` colors mapped through the active theme (custom themes and
  highContrast work now) + width-aware per-line curtail (word highlights
  yield to curtail past budget — alignment can't survive truncation).
- `diffWords` bails to fully-changed past 50k LCS cells (minified-line DoS
  closed) +1 test.
- `TuiPermissionBroker` serves FIFO from a queue (concurrent requests no
  longer orphan promises) +3 interaction tests (order, always-short-circuit,
  unsubscribe).

## 3. P1-3 — TRANSPORT FRAMING

- Pure `createLineSplitter` (StringDecoder multibyte safety, 1 MiB line cap
  with fail-fast, CRLF handling) +3 unit tests; stdio transport rebuilt on
  it (prune-on-error, stdin-error fast-fail included).
- Env allowlist gains HOME/USER/TMPDIR/TEMP/SystemRoot (npx/Python no longer
  fail mysteriously; API keys still never inherited).
- `close()` is SIGTERM → 500ms grace (unref'd, exit-cleared) → SIGKILL,
  pid-reuse-guarded via exitCode checks.

## 4. P1-4 — CHECKPOINTS

- `takeSnapshot`/`restoreCheckpoint` fully async (fs/promises); the stat/read
  TOCTOU closed via open→fstat→bounded-read on one file description.
- Snapshot targets deduped per batch.
- Sub-agent rings merge into the parent (fresh ids, capped, `checkpoint_merged`
  ledger entry, abort path included) — `/rewind` reaches sub-agent writes.
  +1 delegation round-trip test proving restore of sub-written bytes.

## 5. P1-5 — COMPACTION

- Exactly one summarization attempt per turn (the flag gates on the cheap
  preconditions — and the new test caught the naive placement burning the
  attempt on a below-threshold no-op; fixed before green).
- Summarizer throw → skip and continue (best-effort) + empty summary → no-op
  (placeholder poison removed).
- `mergeSummaryIntoHistory` pure helper preserves role alternation +3 unit
  tests; session-level test asserts single compaction + no consecutive users.
- Deleted the dead `summarizer` fixture the review flagged.

## 6. P1-6 — FREEMODELS

- Single-flight + freshness keyed by sources+key-hash (secrets hashed, TTL
  stays a read policy — the existing B1/B2 TTL test pins this).
- Freshness seeded lazily (import-time ANVIL_HOME read gone).
- Merge-preserving cache (failed sources keep last-good data; all-fail
  leaves the clock alone so the next call retries).
- Numeric zero pricing accepted; per-provider-group merge.
- +4 tests (cross-cred flights, partial-failure cache, numeric pricing ×2).

## 7. P1-7 — STREAM FIDELITY

- New `providers/streaming.ts`: `ensureTurnEnd` (exactly-one guarantee) +
  `ToolCallAssembler` (id freeze, name-deferred start, cumulative deltas,
  ordered drain).
- OpenAI translator rebuilt on it + usage-once; Anthropic skips id-less
  blocks + adapter wrapped in `ensureTurnEnd`; Gemini finish precedence
  (error > max_tokens > tool_use) + safety→error mapping + cross-turn-unique
  synthetic ids.
- `partialInputJson` renamed `cumulativeInputJson` across types/adapters/
  session/tests (the name lied; behavior already cumulative).
- Contract tests: assembler (4), openai (+2: usage-once, deferral+freeze),
  anthropic (+1: id-less silence), gemini (+3: cutoff precedence, safety
  errors, id uniqueness); one old mapping test updated to the honest
  behavior (recorded, not silent).

## 8. VERIFICATION

```bash
npm run build -w @anvil/core
npm run typecheck               # 0 errors, all 3 packages
npm test -w @anvil/core         # 202/202 across 29 files (was 177/27)
npm test -w @anvil/tui          # 81/81 across 16 files (was 76/15)
npm run build                   # esbuild bundle OK
```

Result: ALL GREEN. Catches during the slice (all fixed before green): the
compaction-flag placement bug (own test caught it), a duplicated describe
close, a dropped test restored, dynamic `node:events` import typing, `as
never` replaced with a real throwing generator, mixed-array test typing via
exported `ScriptEntry`.

## 9. WHAT'S LEFT (P2/P3 + standing partials — unchanged, still tracked)

P2 slop paydown (§3 of the review), P3 structural splits, and the design
partials (side-by-side diffs, per-tool expand, auto-summary, picker/overlay
interaction tests, remote MCP, CJK widths). Nothing from P0/P1 remains open.
