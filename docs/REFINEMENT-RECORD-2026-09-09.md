# REFINEMENT RECORD — robustness + stability slice (2026-09-09)

> Status: IMPLEMENTED + VERIFIED (gates in §5). Follows the repo's record
> conventions (`HARDENING-RECORD.md`, `AUDIT-2026-09-06.md`): verified facts,
> exact file lists, decisions with rejected alternatives, and the verification
> commands that must be re-run before any "done" claim.

## 0. SCOPE — what this slice does and does not do

IN: four code-refinement items from a chief-engineer code review, each with tests:
1. **Bounded `read_file`** — stop materializing whole files before the 512 KB cap
   (a multi-GB log could spike/OOM the heap just to keep a 512 KB head).
2. **`run_command` preview guard** — `describe()` no longer reaches into a
   malformed input object (the one path feeding the permission prompt).
3. **Tunable command/test timeouts** — `ANVIL_RUN_COMMAND_TIMEOUT_MS` and
   `ANVIL_RUN_TEST_TIMEOUT_MS`, sanitized and clamped to [1 s, 10 m].
4. **Compaction fallback** — reactive compaction now still fires when a provider
   emits no `usage` event (previously `lastInputTokens` never moved, silently
   disabling the loop-top compaction check on a growing history).

PLUS (this record's own shipping/polish):
5. **CI unit-test + typecheck gate** — a second GitHub Actions workflow
   (`ci.yml`) so every push/PR runs build + strict typecheck + the full unit
   suite; the existing `visual-regression.yml` already covers the visual gate.

OUT (deliberately deferred): live provider-adapter smoke tests against current
SDK versions (registry model IDs rot fastest; needs keys/network), a structured
observability/logging layer, and a session-retention/GC command. See §6.

## 1. CHANGES (exact file list — `git status` must show only these + docs)

```
MODIFIED:
  packages/core/src/tools/readFile.ts               # open→fstat→bounded-read; true totalBytes
  packages/core/src/tools/readFile.test.ts          # +1 truncation test
  packages/core/src/tools/bash.ts                   # describe() null guard + runCommandTimeoutMs()
  packages/core/src/tools/bash.test.ts              # +3 timeout tests (+afterEach import)
  packages/core/src/tools/verifyTests.ts            # runTestTimeoutMs() + bounded duration
  packages/core/src/tools/verifyTests.test.ts       # +3 timeout tests
  packages/core/src/agent/session.ts                # sawUsage flag + estimateTokens fallback
NEW:
  .github/workflows/ci.yml                          # typecheck + unit-test gate
  docs/REFINEMENT-RECORD-2026-09-09.md              # this file
```

## 2. DESIGN DETAILS

### 2.1 Bounded read_file (`tools/readFile.ts`)
- Open a `FileHandle`, `stat()` it, then read at most `MAX_BYTES` from the SAME
  open file description — the pattern already used by `checkpoints.ts`. The
  stat and read observe the same file, so a concurrent writer can't race the
  size check against the read (the old `fs.readFile`-then-slice had that TOCTOU
  and hoisted the whole file into memory).
- `output.totalBytes` stays the TRUE file size from `stat` (preserves the public
  contract: "how much was truncated"), while `content` and `summary` reflect only
  the bounded head. Locked in by the new truncation test.
- Rejected alternative: keep `fs.readFile` and slice — unbounded memory remains.

### 2.2 Command preview guard (`tools/bash.ts`)
- `describe` now reads `command` defensively with a typeof check and reports
  `"(malformed input)"` on bad input instead of throwing (was caught upstream,
  but it is the sole path feeding the permission prompt).

### 2.3 Tunable timeouts (`bash.ts`, `verifyTests.ts`)
- `runCommandTimeoutMs()` / `runTestTimeoutMs()` read an env override, fall back
  to the built-in (120 s / 60 s) when unset or non-finite, and clamp to
  [1_000, 600_000] ms so a hostile/typo'd value can neither busy-freeze a turn
  (`0`) nor park it for an hour. The `setTimeout` and the "Timed out after …
  ms" summary both use the resolved value. Defaults unchanged → zero behavior
  change by default.

### 2.4 Compaction fallback (`agent/session.ts`)
- `lastInputTokens` only ever moved via the provider `usage` event. A provider
  that never emits usage left it stale, so the reactive compaction check at the
  loop top (`this.lastInputTokens >= contextWindow * COMPACTION_THRESHOLD`) could
  never fire as history grew. A per-request `sawUsage` flag now triggers
  `estimateTokens(this.history.snapshot())` right after the assistant turn is
  recorded, biasing conservative (earlier compaction beats an unhandled provider
  context overflow). Providers that do emit usage are unaffected (flag true).

### 2.5 CI unit-test gate (`.github/workflows/ci.yml`)
- New workflow on push/PR to `master`/`main`: `npm ci` → `npm run build` →
  `npm run typecheck` → `npm test`. Build runs BEFORE downstream typecheck/test
  because tui/cli resolve `@anvil/core` from its built `dist/` in the workspace.
- Kept separate from `visual-regression.yml` (visual matrix + artifact upload)
  so the unit gate is fast, clear, and independent.

## 3. AUDIT CORRECTIONS (things I flagged in review, then verified as NOT bugs)

1. **Gemini synthetic call-id counter is global/monotonic** — CORRECT AS-IS.
   Cross-turn AND cross-session uniqueness is exactly the contract the unit test
   pins ("synthesizes call ids unique across turns"). Replacing it would add risk
   for no benefit. No change.
2. **Free-model registry merge isn't atomic** — CORRECT AS-IS. `mergeFreeModels`
   is fully synchronous (no `await`), so under single-threaded JS the shared
   `MODEL_REGISTRY` is never observed mid-merge. No change.

## 4. REMAINING RISKS (not introduced here, still open)

- Model registry rows hardcode frontier IDs verified at write-time; they rot
  fastest of any static data. Free-model sync covers OpenRouter only.
- `read_file`/`write_file`/`edit_file` caps (512 KB) are tuned for model context,
  not large-file workflows; large-file reads stay bounded by the tool caps.
- No structured logging/metrics; diagnosing a production session post-hoc relies
  on the session file + run ledger.

## 5. VERIFICATION (run exactly, in order)

```bash
cd /home/mitravanu/Projects/anvil
npm run typecheck              # 0 errors, all 3 packages
npx vitest run src/tools/__tests__/readFile.test.ts src/tools/__tests__/bash.test.ts src/tools/__tests__/verifyTests.test.ts src/agent/__tests__/session.test.ts src/agent/__tests__/compaction.test.ts src/agent/__tests__/proactiveCompaction.test.ts
npm test -w @anvil/core        # full core suite
npm run build                  # esbuild bundle OK
git status --porcelain         # only §1 files
```

Result on 2026-09-09: ALL GREEN — typecheck 0 errors across all 3 packages; core
suite 293/293 across 43 files (incl. 6 new timeout tests + 1 truncation test);
full monorepo build succeeds (cli bundle 6.3 mb); working tree shows only §1 files.

### 5.1 LIVE PROVIDER VERIFICATION — OpenRouter (N1, partially closed)

With an OpenRouter key linked (`~/.anvil/credentials.json:openrouterApiKey`, never
logged), the adapter was verified against the REAL `openrouter.ai/api/v1` gateway
on 2026-09-09 — not mocks:

- **Free-model sync (boot/picker path)**: real `/models` fetch → 21 free models
  live, 18 tool-capable → `syncFreeModels` merge detected genuine churn
  (6 newlyFree / 3 noLongerFree) → registry 45→51 → cache persisted to
  `~/.anvil/models-cache.json` (was 2 days stale, past the 10-min TTL).
- **Plain streaming**: real SSE through `createOpenRouterProvider` (shared
  `translateChatCompletionsChunkStream`): text deltas + usage + `end_turn`.
  `cohere/north-mini-code:free` replied exactly `ANVIL-LIVE-OK`.
- **Tool-call round-trip**: OpenAI `tool_calls` deltas → Anvil events:
  `tool_call_start(get_weather)` → cumulative deltas `{"city": "Paris"}` →
  `tool_call_end` with parsed input → `stopReason: "tool_use"`.
- **Error channel**: 429 rate-limits from saturated free models surface as a
  clean `{type:"error"}` event (terminal, no turn_end) — the hardened path works.

Notes: free-tier 429s are per-model; the free-model list churns daily, so the
repeatable script takes `OPENROUTER_MODEL` override. `openrouter/free` (auto
router) injects its own prompt — its reply text is not the adapter's concern
(input tokens showed the router's overhead; streaming itself was correct).

**Now repeatable**: `npx tsx packages/core/scripts/verify-openrouter.ts`
(key from `OPENROUTER_API_KEY` env, else the credentials file; 3 phases above;
exit 1 on any failure).

### 5.2 LIVE PROVIDER VERIFICATION — Gemini (N1)

Same day, key already on file (`~/.anvil/credentials.json:geminiApiKey`), real
`generativelanguage.googleapis.com`:

- **Plain streaming** (`gemini-3.6-flash` via `verify-gemini.ts`): text deltas +
  usage (18 in / 7 out) + `STOP` → `end_turn`. Reply: "Hello to you, my friend."
- **Tool-call round-trip** (`gemini-3.6-flash`): whole-call `functionCall` →
  `tool_call_start(get_weather)` → `tool_call_end` with parsed
  `{"city":"Paris"}` → `stopReason: "tool_use"`. No deltas — correct, Gemini's
  shape carries the complete call in one part (adapter comment says as much).
- **Quota finding**: `gemini-3.1-pro-preview` returns free-tier quota errors with
  `limit: 0` — confirms the registry's "not eligible for free tier" note; the
  429 surfaced as a clean terminal `{type:"error"}` event (hardened path OK).
  `gemini-3.6-flash` has free-tier quota and is the right default for key testing.

### 5.3 ORCAROUTER PROVIDER (free-only) — implementation + live checks

Orcarouter (`https://api.orcarouter.ai/v1`, OpenAI-compatible, key on file in
opencode's auth store) added as a provider alongside OpenRouter:

- **Free-only policy, enforced at the source**: orcarouter's `/models` carries NO
  pricing metadata — free/paid is signaled only by the id. `isFreeModelId()`
  (`-free` suffix, or the `orcarouter/free` alias) gates the live fetch, so paid
  ids (live-verified: `fusion`, `fusion-flash`, `fusion-mini`, `auto`) can never
  enter the registry. The picker additionally renders `visibleModels()` only —
  paid entries (including OpenRouter's static `deepseek/deepseek-v3.2`) are
  auto-hidden from model selection everywhere.
- **Auto-sync**: CLI boot, the TUI picker, and `/sync` all pass both sources
  (OpenRouter + Orcarouter) through the single-flight/TTL coordinator; churn
  (new free models, models going paid, models vanishing — e.g.
  `deepseek/deepseek-v4-flash-free` disappeared from orcarouter between the
  owner's last use and this implementation) updates the registry automatically.
- **Live verification** (real gateway, real key): Phase 1 gate holds — exactly
  `orcarouter/free` + `qwen/qwen3.8-27b-free` returned, zero paid leak. The
  key is scoped: the alias `orcarouter/free` returns a clean 403
  "key does not have access" (surfaced as a terminal error event); the concrete
  `qwen/qwen3.8-27b-free` is authorized but the free pool was at capacity
  during testing ("503 No available capacity" — same operational class as a
  429, now detected by `isRateLimitMessage` for auto-retry). Streaming/tool
  round-trip on this provider remains to be observed when capacity allows;
  the wire format is the shared, live-verified chat-completions path.
- **Tests**: new `orcarouter.test.ts` (15 tests): id gate, paid-drop at source,
  header handling, error surfacing, provider wiring, `visibleModels()` hiding,
  default-model resolution, dual-source sync merge, single-source-failure
  isolation, dedup. Suite: 305 passed.

## 6. SUGGESTED NEXT SLICES (owner picks order)

- N1: **Live provider-adapter smoke test** — OpenRouter DONE (§5.1: real-gateway
  sync + streaming + tool-call round-trip, repeatable via
  `core/scripts/verify-openrouter.ts`); Gemini DONE (§5.2: plain streaming +
  tool-call round-trip on `gemini-3.6-flash`; note `gemini-3.1-pro-preview` has
  zero free-tier quota). Still open: Anthropic + OpenAI (no keys on file) —
  re-verify adapter wire-format assumptions with the ship's
  `core/scripts/verify-*.ts` (`@anthropic-ai/sdk 0.122.0`, `openai 7.8.0`) as
  keys/network allow.
- N2: **Structured observability** — a lightweight log sink for provider retries,
  circuit opens, and compaction events (event-emitted today, not persisted).
- N3: **Session retention/GC** — prune stale `~/.anvil/sessions` + checkpoints per
  a retention policy.