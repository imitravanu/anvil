# P0 RECORD — code-review fix program, Batch A–D (2026-09-05)

> Status: IMPLEMENTED + VERIFIED (gates in §4). Executes the P0 list from
> `docs/CODE-REVIEW-RECORD.md` §5. Review items below reference that doc's
> §1 numbers; triage there stands unless noted.

## 1. BATCH A — agent loop + tools

- **sha256 keys** (§1.1): `canonicalInputHash` returns 64-hex digests, never
  input text; plus cycle guard (`[Circular]`) and Date/Buffer pass-through.
  New `agent/__tests__/canonical.test.ts` (+3: order-independence, large-input
  inequality + fixed length, cycles/specials).
- **edit_file cap** (§1.2): `stat` size check vs `MAX_WRITE_BYTES` (shared
  import from writeFile, single source) in `computeEdit` — covers execute
  AND describe paths. +1 oversize test proving refusal + untouched file.
- **unknown→serial** (§2, `?? true`): unknown tool names route through the
  serial/permission branch. +1 test proving no `tool_started` for unknown
  names (the concurrent branch's observable fingerprint) + declared-order
  error results + ledger outcome.
- **permission-cancel race** (§2): broker promise raced against abort; abort
  resolves deny, existing post-check yields `cancelled`. +1 test with a
  never-resolving broker (cancel mid-prompt → cancelled, nothing executed,
  file untouched).
- **ledger token scope** (§1.10): auto-attach of `lastUsage` restricted to
  `tool_finished` (+ explicit always wins). +1 test: control entries carry no
  tokens, completions keep measured ones. (`/ledger` totals now count each
  call once instead of twice — strictly more truthful.)

## 2. BATCH B — atomicity + guards

- New leaf `core/src/atomicWrite.ts` (tmp.$pid + optional pre-rename mode +
  rename; no internal imports → no cycles): adopted by `saveSettings`,
  `saveCredential` (0o600, closing the world-readable window),
  `saveSession`, `saveModelsCacheV2`.
- `session/store.ts`: `SAFE_ID_RE` on load/delete (null/no-op) and save
  (throws); `isStoredSession` shape guard on load; list skips shapeless
  files and sorts null-safe on missing `updatedAt`.
- `config/index.ts`: credential/settings loaders reject non-object JSON.
- Tests: store +3 (traversal probe file untouched, shapeless/missing-date
  safety), config +2 (non-object loads, 0600-from-creation mode assert).

## 3. BATCH C — MCP client

- `McpServerConnection.timeoutMs` (from server config; was validated but
  never read — own debt closed); `callTool` defaults to it.
- `pending: Map<number|string>` — stray string ids ignored without corrupting
  numeric routing (+1 test).
- Pump restarts after death → fast `transport closed` instead of timeout hang.
- Named abort handler removed in `finally` (+1 test asserting zero listeners
  via `getEventListeners`).
- `MAX_LIST_PAGES = 20` + repeat-cursor break (+1 test with hostile cursor).
- Updated `timeoutMs` fixtures in mcpTools/phase10/tui-mcp tests.

## 4. BATCH D — CLI + test hygiene

- `bin/anvil.cjs`: `.catch` with actionable reinstall message (exec bit was
  already 100755 — verified, no change needed).
- SIGINT/SIGTERM/SIGHUP → `killAllMcpServers` + conventional exit codes;
  Unix-only group-kill documented. (Raw-mode TTY Ctrl+C still flows to the
  app as input bytes — handler only fires on real signals.)
- `crash()`: unmounts the tracked render instance + clears raw mode before
  exit (both boot and setup instances tracked). `unhandledRejection`
  behavior deliberately unchanged (diagnostic without teardown).
- `--no-mcp` flag: skips server startup (also answers "boot blocks UI"
  with a user-controlled fast path) + HELP line.
- `ollamaBaseURL()` exported with `/v1`-suffix tolerance; table-driven
  `compat.test.ts` (+4: consts/ids, isConfigured matrix, URL normalization).
- openrouter live test → mocked fetch (both shapes asserted) + global
  registry snapshot/restore + ANVIL_HOME isolation (the old test mutated
  both on success and proved nothing on failure).
- ANVIL_HOME save/restore in cache + freeModels tests; tmpdir double-alloc
  fixed in mcpConfig + custom tests (own slop from earlier slices).

## 5. DELIBERATELY NOT IN P0 (unchanged, still tracked)

Stream-assembler unification, freeModels coordinator rework, transport
framing hardening (StringDecoder/line-cap/backpressure), compaction rework,
broker FIFO, TUI dist build config, manifest engines, flag-parser polish —
all P1/P2 in the review doc. P0 stayed mechanical and reviewable by design.

## 6. VERIFICATION

```bash
npm run build -w @anvil/core
npm run typecheck               # 0 errors, all 3 packages
npm test -w @anvil/core         # 177/177 across 27 files (was 158/25)
npm test -w @anvil/tui          # 76/76 across 15 files
npm run build                   # esbuild bundle OK
```

Result: ALL GREEN. One typecheck catch during the slice (dynamic
`node:events` import typing → static import) fixed before green.
