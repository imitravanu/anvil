# CODE REVIEW RECORD — full line-by-line audit (2026-09-05)

> Status: REVIEW ONLY. No code changed in this slice. Method: four parallel
> subsystem audits (agents, research-only) + head-of-project verification of
> every HIGH claim against source before signing. Items marked **[verified]**
> were read at the cited lines by the reviewer; **[agent-reported]** items
> carry file:line for the fixer to confirm. Overstated agent claims are
> explicitly downgraded with reasons — skepticism is part of the record.

## 0. VERDICT IN ONE PARAGRAPH

The codebase is genuinely well-built: real permission boundaries, honest
error surfacing, deterministic tests, records that match the tree. It is
NOT slop — but it has the characteristic profile of fast agent-written
code: strong happy paths, thin adversarial edges. ~13 findings deserve
fix-soon status (unbounded reads/keys, dead config fields, stream-fidelity
gaps, shutdown leaks, a live-network test), ~25 are real but bounded
robustness gaps, and the rest is slop paydown (duplication, dead code,
magic numbers, doc drift). No finding warrants a rewrite of any module;
the largest structural job is splitting `send()` and unifying the three
stream translators. Recommended execution order is §5.

## 1. FIX SOON (confirmed, high leverage, mostly small)

1.1 **`canonicalInputHash` is not a hash** [verified] — `agent/canonical.ts:18-24`
returns full canonical JSON. Every ledger entry and loop-guard key embeds
complete tool inputs — a 512 KiB `write_file` puts 512 KiB strings into
`totalCounts`, `prepared[].key`, and persisted `runLedger` entries, defeating
the intent of `LEDGER_CAP`. Fix: `sha256(canonicalJson)` hex (16 chars) +
keep a short preview for debugging. Also add cycle guard + pass-through for
Date/Buffer (currently treated as plain objects).

1.2 **`edit_file` reads unbounded files** [verified] — `tools/editFile.ts:39`
`fs.readFile(abs, "utf8")` with no cap while siblings cap at 512 KiB; both
`execute` AND `describe` (permission preview) do the full read, so a 100 MB
file OOMs the turn before the user even approves. Fix: `stat` size check vs
`MAX_WRITE_BYTES`, refuse with an explicit error.

1.3 **MCP `cfg.timeoutMs` is a dead field** [verified — own debt] —
`config/mcp.ts` validates/defaults it (60s) but `connectServer` and
`callTool` only read call-site `opts.timeoutMs`. Per-server tuning silently
does nothing. Fix: carry `timeoutMs` on the connection at connect time;
`callTool` defaults to it.

1.4 **Stream-fidelity gaps in all three translators** [verified] —
`openai.ts:79-88` mutates tool-call `id` after emitting `start` and emits
`start` with `name: ""`; `anthropic.ts:53-58` emits `start{id: ""}` then
drops deltas/end for it (silent tool loss); `anthropic.ts:86-97` emits no
`turn_end`/`usage` when `message_delta` never arrives; `openai.ts:93-99`
emits `usage` per chunk (StatusBar accumulates → double-count if a server
sends it twice); `gemini.ts:116-117` forces `tool_use` over MAX_TOKENS/
SAFETY. The agent loop survives these today (end-event fallbacks), so this
is fidelity loss + stuck/missing UI state, not hangs — two agent reports
overstated "hangs"; corrected here. Fix: shared `ToolCallAssembler`
(id-frozen, name-deferred), `UsageAccumulator` (emit-once), guaranteed
`turn_end`, safety→`error`/`blocked` mapping. Cover with contract tests
(all four shapes are currently untested).

1.5 **Free-model coordinator integrity** [verified] — `freeModels.ts:223`
single-flight ignores caller opts (wrong creds shared); `:125-132`
`ANVIL_HOME` seeded at import (stale for process lifetime);
`:266-276` partial failure persists only ok-sources, drops failed sources'
cached models while stamping fresh; `:55` string-only `"0"` pricing misses
numeric zeros; `:254` assumes homogeneous provider per source. This is the
co-core pillar — fix as a cluster: key single-flight, lazy seed, merge over
loaded cache, `String(...)` pricing, per-provider-group merge.

1.6 **Shutdown + crash paths** [verified] — `cli/bin/anvil.cjs:1-2` has no
`.catch` (fresh global install without `dist/` dies cryptically);
`cli/src/index.tsx` hooks only `exit`, so SIGINT/SIGTERM/SIGHUP orphan
detached MCP server groups; `crash()` promises "never leave raw mode broken"
then exits without unmounting Ink or clearing raw mode. Fix all three;
document Unix-only group-kill.

1.7 **Non-atomic writes + silent readers** [verified] — `saveCredential`
(write→chmod: world-readable window), `saveSettings`/`saveModelsCacheV2`/
`saveSession` (bare writes; crash = corrupt JSON), while every reader
returns empty/skips on corruption — corruption silently deletes keys,
sessions, cache. Fix: `tmp.$pid + fsync + rename`, `chmod 0o600` before
rename, keep never-throw reads.

1.8 **Live-network test** [verified] — `providers/__tests__/openrouter.test.ts:67-73`
does a real `fetch` with assertions that pass on failure too, and on success
mutates the global `MODEL_REGISTRY`. Mock `fetch`, assert both shapes, clean
up (or gate behind `LIVE`).

1.9 **Sub-agent writes invisible to rewind** [verified by design] — sub runs
own `AgentSession` with own ring; parent snapshots only its own `prepared`
(`delegate_task` never snapshotted); sub ring discarded on return. `/rewind`
after delegation restores nothing of what the sub changed — an honesty gap
in a shipped feature. Fix: merge sub checkpoints into the parent (capped)
or snapshot around `runSubAgent`.

1.10 **Ledger token auto-injection** [verified] — `session.ts` `recordLedger`
attaches `lastUsage` to every entry lacking explicit tokens, so
`loop_detected`/`budget_exhausted`/`cancelled`/`checkpoint_created` carry
fabricated attribution, contradicting the file's own "record, never predict"
comment. Fix: attach only caller-passed tokens.

1.11 **`OLLAMA_HOST` `/v1/v1`** [verified] — `providers/ollama.ts:8-10`
strips slashes then appends `/v1` unconditionally. Three-line fix, zero test
today; add table-driven adapter tests (baseURLs + token params for all five
compat providers — all five have zero tests).

1.12 **`stream_options: include_usage` unconditional** [agent-reported,
high-confidence] — `openai.ts:221` in the shared factory; five compat
adapters may 400. Add opt-out flag, probe per provider.

1.13 **Unconditional `session/store.ts` traversal + comparator crash**
[verified] — `save/load/deleteSession` interpolate `id` into paths
(self-attack-only: ids are UUIDs or the user's own CLI arg — downgraded to
defense-in-depth, still a 3-line regex); `listSessions` comparator throws on
missing `updatedAt`, bricking `/session` over one bad file (medium, fix with
`?? ""` + schema guard on load, which is also missing).

## 2. REAL BUT BOUNDED (robustness, schedule normally)

- **TUI state honesty**: `usage` never resets on session change (stale
  StatusBar after `/clear` — [verified], 3-line `useEffect`); cancelled/error
  turns strand running tool spinners (U10 fixed subs, not toolCalls —
  [verified]); `subagent_finished` no-running-card fallback renders `(no task)`
  ([verified], carry task or drop branch); `Math.random()` resume keys
  ([verified], deterministic `seed-i`); `task-i` card keys collide on duplicate
  tasks ([verified], add controller-side counter id); unbounded
  `messages[]`/`sentHistory[]` ([verified], cap with ledger note); missing
  `.catch` on `rewind()`/`reconnect()` promises ([verified], one-liners —
  both callees never throw by construction, but say so in code).
- **Quiet data loss**: `MessageList` window cap with no omission notice and no
  scrollback ([verified]); `getHistory`/`getRunLedger` return live arrays
  behind `readonly` ([verified], spread-copy).
- **Narrow-terminal overflow**: hard-coded diff colors bypass `useTheme`
  (breaks the just-shipped custom themes/highContrast — [verified],
  map through theme); no per-line `curtail` in diff/prompt ([verified]);
  UTF-16 width math in Header/StatusBar/PlanLine/tables ([verified], shared
  `displayWidth()` later; CJK documented limits stand).
- **Word-diff DoS**: `wordDiff.ts` LCS unbounded per line pair ([verified]);
  bail to fully-changed past 50k cells.
- **Prompt hangs**: `await broker.requestPermission()` has no abort race;
  PermissionPrompt has no cancel path ([verified]); broker itself clobbers
  concurrent requests ([verified]) — unreachable today (serial prompts) so
  queue it defensively, not urgently. `send()` double-Enter is already safe
  via the session `isSending` guard ([verified] — agent HIGH downgraded).
- **Compaction**: runs every iteration with no reset ([verified]), summarizer
  throw kills the turn, `"(summary unavailable)"` poisons history, possible
  consecutive-user roles ([verified]); make once-per-turn, best-effort,
  role-normalized.
- **Checkpoints**: fully sync I/O in-turn (up to 2 MiB on the event loop),
  `stat→read` TOCTOU, raw user paths echoed ([verified]); also snapshots
  refused/denied no-ops and duplicates same path ([verified]) — dedup +
  async + snapshot the `toRun` set.
- **Sub-agent accounting**: `catch { aborted = true }` swallows crashes into
  empty reports ([verified]); `capReport` slices UTF-16 ([verified],
  `Array.from`).
- **Tools**: `grep` ReDoS + no abort/timeout ([verified] `new RegExp` line 53,
  no signal use); `read_file` decodes binaries as UTF-8 ([verified], NUL-skip
  like grep); `listFiles` uncapped ([verified]); `write_file` loses exec bit +
  uncapped describe read ([verified]); `bash` abort TOCTOU ([verified]),
  no `HOME` in env, no `stdin: "ignore"` ([verified]); `describe`/`err.message`
  throw on nullish/circular ([verified]); `toGeminiContents` silent losses
  ([agent-reported]); synthetic Gemini ids reset per turn ([agent-reported]).
- **Providers**: silent `{}` JSON fallbacks ([verified] ×3 adapters);
  `as never` casts hiding SDK drift ([verified]); OpenAI raw-string args vs
  Anthropic try-parse ([verified]); `thoughtSignature` coverage exists by
  design (fine); registry `128_000` placeholders as fake precision
  ([agent-reported], use real windows or unknown); cache entry validation,
  future-`syncedAt`, legacy-overwrite ([agent-reported]); `429` map unbounded
  + bare-`quota` regex ([verified] line 118 loose); empty-list guard masks
  all-paid ([agent-reported]); `PROVIDER_ORDER` manual tracking, typo→"not
  configured", unvalidated model ids, `"unknown-model"` placeholder
  ([verified] shape, agent-reported details); credentials cast without shape
  check + EACCES→`{}` ([verified]); `mcp.json` url-detection type-narrow
  ([verified]); `loadSession` without schema guard ([verified]); MCP
  description unbounded ([verified], truncate ~500); MCP env strips HOME
  ([verified], allowlist HOME/USER/TMPDIR); transport close without SIGTERM
  grace + `liveChildren` error-prune gap ([verified]); transport `send`
  throw path + non-object args coercion ([verified]); string-id replies miss
  numeric-only pending map ([verified]); pagination uncapped ([verified]);
  pump never restarts after death ([verified]); per-request abort listener
  never removed on success ([verified] — bounded by per-turn signal GC, so
  medium-low, not the claimed OOM); UTF-8 split + unbounded line + no
  backpressure ([agent-reported, standard hardening]).
- **CLI/packaging**: TTY half-check ([agent-reported, plausible]); TUI `dist`
  ships compiled tests ([verified] build config) while `vitest` include only
  hides them from runs; published manifests lack `engines` ([verified]);
  esbuild banner/alias fragility ([agent-reported]); minimal flag parser
  ([agent-reported]); MCP boot blocks UI up to 10s ([verified] shape);
  child stderr tearing Ink fullscreen ([verified], spec-mandated — needs a
  log-file-behind-flag follow-up).
- **History invariants**: empty assistant turns unpushed → possible
  user/user adjacency ([verified] lines 351-364; Anthropic rejects these —
  medium-low); `update_plan` loop bypasses refusal but budget caps at 20
  ([verified] — low); `switchModel`/`clearHistory` leave ledger/plan/tokens
  stale ([agent-reported]); unknown tools join concurrent batch — harmless
  today (they error) but `?? true` is the one-line hardening ([verified]
  shape).

## 3. SLOP PAYDOWN (mechanical, batch it)

Duplication: `ToolCallView`/`SubAgentView` card shells + twin 30-line caps
([verified]); pricing-tag logic ×3 ([verified]); scroll-windowing ×2
([verified]); `App.tsx` streaming/settled branch duplication ([verified]);
`App` God-component + 12 inline command closures + command triple-touch
(types/registry/App — [verified]); provider-label drift FirstRunSetup vs
labels util ([verified]); `anvilHome()` ×4 copies ([verified] — the
HARDENING record overclaimed "unification": only the TUI reuses core's
export); `REFERER/TITLE` ×2 ([agent-reported]). Dead code: `currentAssistantId`
([verified]), `panelPaddingY` ([verified] zero uses), `sentHistory` default,
compaction-test dead fixture ([agent-reported]), `models: _models`
([verified]), `REQUIRED_COLOR_KEYS` comment says 12, there are 11
([verified] — own typo). Magic numbers (`60/40/8/15/30/6000/4000`, gutter
widths — [verified] scattered). Index-as-key everywhere ([verified]).
Comment essays about removed code ([verified]). Over-abstracted one-use
helpers (`grouping`, format wrappers — judgment call, keep). `eventType:
string` should be a union; `sortKeys` needs cycle guard ([verified] shape).
`editFile` diffs before uniqueness check ([verified]). `parseCommand`
quirks + `/rewind` hex parsing ([verified] shape). App frame off-by-2
([agent-reported]). Theme fallback silence + no reload ([verified] shape).
`highContrast.dim = "white"` ([verified] — funny, one line). `retainOutput`
stringifies before capping ([verified] — spike on huge outputs).
`testRender.tick(60)` magic ([verified] — poll-with-deadline).
`getFreeModels` spec/code rename drift, `takeSnapshot` signature drift,
dead `misconfigured` status, `registerExternalExecutor` 3rd-arg drift —
amend the four specs ([verified] shapes). Test-count rot in records
([verified] — stop asserting totals, generate or drop).

## 4. TEST HYGIENE (fast, do with fixes)

Proved gaps: thin adapters zero tests ([verified] — table-driven baseURL/
params test); InputBar Tab/recall-reset/menu-suppress/Ctrl+C paths, App
command wiring, `useAgentController` all-branches, broker queue,
`TableView` ragged/CJK, highlighter normal path, streaming branch,
StatusBar hint-hide branch, unknown-tool prompt copy ([verified] absence
by file inspection). Flakes/risk: bash `sleep`+`ps` timing ([verified]),
`ANVIL_HOME` delete-instead-of-restore in cache/freeModels tests
([verified] pattern vs correct pattern elsewhere), tmpdir double-alloc in
mcpConfig + custom tests ([verified] — own slop, one-line each),
store.test order dependence ([agent-reported]), phase10 global executor
registration ([verified]), registry pollution by openrouter test
([verified] shape — same live-network test as §1.8), `phase9` 10ms race
([agent-reported]), R6 absolute-path inputs masking relative resolution
([agent-reported]), `phase8` concurrency assertion weakness ([verified]
shape), canonical-hash tests missing inequality/large cases ([verified]
absence).

## 5. SUGGESTED EXECUTION PROGRAM

- **P0 (correctness/safety, mostly one-liners)**: sha256 keys; edit_file cap;
  thread `cfg.timeoutMs`; string|number MCP ids; pump restart + listener
  cleanup; pagination cap; chmod-before-write + atomic writes + id regex +
  load schema guards; permission-cancel race; unknown→serial; MCP render-first
  or `--no-mcp`; mock the openrouter test; ANVIL_HOME/tmpdir hygiene.
- **P1 (robustness)**: shared stream assembler + usage-once + guaranteed
  turn_end + safety mapping (with contract tests); freeModels keyed
  single-flight + merge-preserving cache + numeric pricing + homogeneous fix;
  transport StringDecoder/line-cap/backpressure/HOME/SIGTERM; compaction
  once-per-turn + best-effort + role normalize; checkpoints async/dedup +
  sub-ring merge; broker FIFO; usage reset; stranded spinners; MessageList
  omission + state caps; promise catches; picker memo/init/empty states;
  theme-mapped diff colors; per-line curtail; wordDiff bailout.
- **P2 (slop paydown)**: §3 list top to bottom; spec amendments; record-count
  policy; registry real windows; config validation; adapter table tests.
- **P3 (structural, only with tests green)**: split `send()` into
  TurnState/LoopGuard/ToolOrchestrator/HistoryStore; split App
  (`useSessionCommands`, `useThemeManager`); single-touch commands;
  TUI build-config + manifest engines + CI bare-require assert.

## 6. WHAT'S ACTUALLY GOOD (fairness section — verified strengths)

Single-flight coordinator, ledger cap + append-only discipline, path
containment with symlink awareness, permission default-deny on broker throw,
sub-agent depth flag (not just list filtering), checkpoint id discipline,
collision-drop, `ANVIL_HOME` laziness, pre-permission snapshots, fake-transport
determinism, records matching the tree. The convoys move; the edges need work.
