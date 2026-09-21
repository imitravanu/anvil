# PROGRESS — multi-agent coordination

> Per AGENTS.md §1.2: file ownership declarations for concurrent sessions.
>
> **ACTIVE 2026-09-21 (OpenCode session, inception provider):** owns NEW
> `packages/core/src/providers/inception.ts`; `providers/{types,index}.ts`,
> `config/index.ts` (PROVIDER_ORDER), `providers/registry.ts` (mercury models),
> `cert/runner.ts` (cert model + env key), `scripts/certify-provider.ts`
> (ALL_PROVIDERS), tests (`certify`, `compat`, `compatAdapters`,
> `freeProviders`), `packages/tui/src/util/{labels,providers}.ts`,
> `README.md` (10→11 providers), `CHANGELOG.md` (Unreleased entry). No
> protected artifact touched.
>
> **ACTIVE 2026-09-21 (OpenCode session, 26.3 inception matrix):** owns the
> guardian ON/OFF eval lanes on `inception/mercury-2.5`
> (`ANVIL_HOME/evals` reports only) + `docs/PHASE-26-PROGRESS.md` (delta
> record) + `CHANGELOG.md` (delta entry) + this PROGRESS.md entry. No prod
> code; docs + eval reports only. **DONE 2026-09-21:** OFF 15/15 (78.5s),
> ON 15/15 (66.4s), DELTA 0.0 — recorded, full gate green.
>
> **ACTIVE 2026-09-21 (OpenCode session, Phase 27.1):** owns
> `packages/core/src/eval/{types,runner}.ts` (concurrency option + worker
> pool), `packages/core/src/eval/__tests__/runner.test.ts`,
> `evals/run.ts` (--concurrency flag), `docs/PHASE-27-PROGRESS.md` (27.1
> boxes), `CHANGELOG.md` (Unreleased entry). No protected artifact touched.
> **DONE 2026-09-21:** committed 1567eca, pushed, full gate green. Two reds
> fixed en route (own catch{} via Step 1; holes-filter pacing via the 26.3
> sleep test).
>
> **ACTIVE 2026-09-21 (OpenCode session, 26 release closeout):** owns
> `packages/core/src/version.ts`, `packages/{core,tui,cli}/package.json`
> (1.0.0 → 1.1.0), `CHANGELOG.md` ([Unreleased] → [1.1.0] heading),
> `README.md` (Guardian surfaces section), `docs/PHASE-26-PROGRESS.md`
> (phase-gate sign-off), `packages/tui/__visual-baselines__/empty-state.txt`
> (v1.1.0 baseline regen via sanctioned VISUAL_UPDATE=1), plus this PROGRESS.md
> entry. Docs + version strings only; no prod logic touched.
>
> **ACTIVE 2026-09-21 (this session — Buffy, continuation):** owns the 26.3–26.5 work:
> `packages/core/src/guardian/{init,hook,langRules,health}.ts` (hook/langRules/health NEW),
> `packages/core/src/guardian/__tests__/{guardedInit,health}.test.ts` (NEW),
> `guardian/__tests__/guardianToggle.test.ts` (NEW),
> `packages/core/src/agent/types.ts`, `packages/core/src/agent/session.ts` (toggle only),
> `packages/core/src/agent/subagent.ts`, `packages/core/src/tools/types.ts`,
> `packages/core/src/tools/delegateTask.ts`, `packages/core/src/eval/*`
> (types/runner/report/index/delta NEW + tests), `packages/core/src/config/constants.ts`,
> `packages/cli/src/gate.ts` (scanStaged + telemetry + rules loading),
> `packages/cli/src/index.tsx` (--staged/--health wiring + help), `packages/cli/src/health.ts`
> (NEW), `evals/run.ts`, plus docs (roadmap S7 boxes, `docs/PHASE-26-PROGRESS.md`,
> `CHANGELOG.md`).
>
> **ACTIVE 2026-09-21 (OpenCode session, gate-red fix):** owns
> `packages/core/src/lsp/__tests__/lspclientEdges.test.ts` (test-only flake fix:
> wait for both didChange) + this PROGRESS.md declaration. Disjoint from Buffy's
> 26.3–26.5 list above; no shared file edited.
>
> **DONE 2026-09-22 (Buffy, audit + defect sweep):** owns
> `packages/core/src/providers/{streaming,anthropic}.ts`,
> `packages/core/src/agent/turnStream.ts`, `packages/core/src/config/constants.ts`,
> `packages/core/src/tools/{mcpTools,index}.ts`, `packages/core/src/agent/…` (none),
> `packages/cli/src/altScreen.ts`, `packages/tui/src/components/{PermissionPrompt,App}.tsx`,
> plus the matching `__tests__`/`*test.tsx` updates in all three packages and this
> PROGRESS.md entry. No protected artifact touched; no shared file edited.
>
> **DONE 2026-09-22 (Buffy, TUI audit, pass 3):** owns
> `packages/tui/src/components/{FirstRunSetup,GuardianReportCard,ToolCallView}.tsx`,
> and NEW `components/__tests__/{firstRunSetup.test.tsx,calls.test.tsx additions}`,
> plus this PROGRESS.md entry. `packages/core/src/guardian/scanner.ts` was
> temporarily modified to prove the new compile-time guard, then restored
> byte-identical (verified via git status). No protected artifact touched.
>
> **DONE 2026-09-22 (Buffy, TUI audit, pass 2):** owns `packages/core/src/agent/session.ts`
> (`getTools()` only), `packages/tui/src/commands/handlers/{mcp,clipboard}.ts`,
> `packages/tui/src/util/{clipboard,notify}.ts`, `packages/tui/src/components/ContextGauge.tsx`,
> and NEW/updated tests `commands/handlers/__tests__/{mcp,clipboard}.test.ts`,
> `util/__tests__/{clipboard,notify,providers}.test.ts`, plus this PROGRESS.md entry.
> No protected artifact touched; no shared file edited.
>
> **DONE 2026-09-22 (Buffy, TUI audit):** owns `packages/tui/src/markdown/MarkdownView.tsx`,
> `packages/tui/src/theme/custom.ts`, `packages/tui/src/hooks/useSessionCommands.ts`,
> `packages/tui/src/commands/handlers/media.ts`, `packages/tui/src/diff/colorizeDiff.tsx`,
> and NEW `packages/tui/src/markdown/__tests__/MarkdownView.test.tsx`,
> `packages/tui/src/diff/__tests__/colorizeDiff.test.tsx`,
> `packages/tui/src/commands/__tests__/media.test.ts`, plus this PROGRESS.md entry.
> No protected artifact touched; no shared file edited.

---

## CURRENT STATE — verified 2026-09-22 (Buffy)

Read this before the chronological log below. The log is history; this is truth.

- **Gate:** `npm run gate` green, Steps 0 → 5 (sensor, protected-artifact
  manifest, diff scan, full-tree residual drain, sequential build, typecheck,
  unit tests, 15/15 mock evals).
- **Tests:** **1013** green — core 669 / tui 255 / cli 84.
- **CLI coverage:** 55% → 62.3% statements (the S7 target was 80%; remaining
  gap is index.tsx's Ink/render paths, which need an interactive harness).
- **Concurrent work detected (2026-09-22):** an in-flight `qwencloud` provider
  (`packages/core/src/providers/qwencloud.ts` + `ProviderId` union change in
  `types.ts`) is in the working tree, NOT from Buffy — left untouched per the
  collision guard. It is mid-integration (core typecheck will fail until
  `PROVIDER_CERT_MODELS`/registry learn the new id). If you are picking up
  Anvil, coordinate there first.
- **Docs-vs-code is now mechanical:** `packages/cli/src/__tests__/docTruth.test.ts`
  asserts the release badge == `CORE_VERSION`, provider count == the registry,
  tool count == `TOOL_DEFINITIONS`, the Node badge == `engines.node`, the roadmap
  status header == its own checkbox count, and the certified-provider table ==
  the registry's rows + only env vars core actually reads. Every expected value is
  derived from code, so the suite can only fail on drift. **Do not hand-edit those
  doc claims without running it.**
- **Remote:** `origin` is reachable; whether to push is a human decision.
- **Known open (features/gaps, NOT defects):** every TUI production file has been
  read and audited (2026-09-22, three passes); `packages/cli/src/index.tsx` is
  still partly uncovered; Windows is second-class (bash + a Unix-only kill-tree);
  no cost estimation, no session search.

---

## 2026-09-22 — CLI coverage: S7 gap closed to 62% (Buffy)

The last open thread from my own work: CLI coverage sat at 55.05% against the
roadmap's 80% target. Closed what is closable without an interactive harness.

**A real defect fell out of writing the tests** (`guardian/health.ts`): core's
`readSnapshot` only validated `timestamp`, so a truncated-but-parseable snapshot
was returned and crashed `deriveHealth`/`formatHealth` — `anvil health` dies on
a hand-edited or half-written file instead of showing the honest empty state.
Now the full schema is validated (pinned in core's suite, 12/12) and the CLI
test initially FAILED against the stale dist, which was the RED proof.

**New suites:** `health.test.ts` (0% → 80%; env-relocated ANVIL_HOME, real
snapshots via core's own `recordHealthScan`, no mocks), `initGuarded.test.ts`
(82% → 100%; hook-executable-bit pinned, throw path via ENOTDIR). `entry.test.ts`
grew 2 → 9: help, health, init, gate-on-non-git, first-run non-TTY, run-path
non-TTY guidance (hermetic via a readStdin stub), and the SIGTERM handler's
cleanup-then-exit-143 contract. The harness now `chdir`s into the temp home —
while writing these tests I found the `init` entry test had run against the
repo cwd (it also would have appended hooksPath to .git/config in a fresh
clone; here the key already existed).

`goalRunner.test.ts` covers the SIGINT lifecycle with the REAL listener
registry (listenerCount before/after; no `as never` casts — my first mock-
based attempt fought TypeScript overloads and was replaced).

**Final: 62.35% stmts / 59.81% branch (was 55.05/51.71). The remaining gap is
`index.tsx`'s Ink-mounted paths (chat boot, headless/goal boots) — they need a
render/exit harness, a deliberate build, not a drive-by.**

---

## 2026-09-22 — Core audit complete: tools, persistence, guardian, cert, lsp (Buffy)

Final unaudited surface read (~50 files). One real defect; everything else clean.
Also retracted one of my own claims before it landed.

**Retraction — the orchestrator "sync-throw gap" was never real.** I initially
"hardened" `ToolOrchestrator` against a describe() that throws synchronously, on the
theory that a try block only catches what crosses an await. That is false in JS: a
synchronous throw inside a try is caught whether or not an await follows. The
orchestrator was always safe; the only genuine bug was `editFile.describe`
dereferencing `input.path` in its own catch. Fixed the comment to state the real
invariant and removed the redundant guard.

**1. `edit_file` describe() crashed on null input (`tools/editFile.ts`).**
`describe` dereferenced `input.path` inside its catch — a malformed (null) input on
its way to being rejected as malformed threw a TypeError out of the preview path.
Only editFile was affected: bash and writeFile describe()s are already null-safe,
and plugin describes ride the orchestrator's catch. **RED-proven:** the old body
throws out of its own catch; the new fallback string is built from a checked path
before the try.

**Audited clean, no change:** tools (`paths`, `readFile` open-fstat-bounded-read,
`writeFile`, `listFiles` glob/substring split, `grep` catastrophic-backtracking
shape check + per-match cap + stat-before-read, `outline`, `verifyTests` argv-array
spawn + env allowlist, `delegateTask` budget clamps + delegation caps, `updatePlan`,
`updateMemory`, `mcpTools`); persistence (`historyStore` push invariants,
`ledger`/`sessionLedger` caps + attribution rule, `canonical` cycle-guarded hash,
`checkpoints` TOCTOU-safe bounded reads + path re-resolution + external-edit
detection, `checkpointStore` atomic 0600 writes + per-entry load validation,
`rewindRing` honest eviction counters); guardian (`scope`, `allowlist`, `hook`,
`langRules`, `init`, `health` — split-literal patterns so the gate never scans its
own rule sources, atomic telemetry, MAX-arbitrary-constants honored); `lsp/*`
(Content-Length framing, EPIPE handling, unref'd idle timers, honest source field);
`cert/*` (harness-only, honest mock/live provenance).

**Noted, deliberately not fixed:** `verifyTests.execute` passes a non-string
`pattern` through to `argvWithPattern`, which throws — contained by `executeTool`'s
try/catch into a generic "verify_tests failed" (cosmetic, not a crash);
`grepFallback` in `lsp/tools.ts` assumes the grep output shape it itself created
(safe today, would misreport if grep's output contract changed).

---

## 2026-09-22 — TUI audit, pass 3: last files, one crash path (Buffy)

Read the final TUI files (`DiffModal`, `MissionDeck`, `RewindModal`, `ThemePicker`,
`VerificationCard`, `index.ts`, `eventReducer.ts`) — the package is now fully read.
One real defect, two honest reclassifications.

**1. A failed credential save killed the app mid-onboarding
(`components/FirstRunSetup.tsx`).** `saveCredential` writes `~/.anvil/credentials.json`
and throws on a full disk or unwritable home — and the call sat bare inside an Ink
input handler, where a throw escapes as an uncaught exception. A user pasting a key
into a machine with a read-only home didn't get an error message; the process died.
Now caught, surfaced in the card, retried in place (`saveSession` in
`useSessionCommands` is already wrapped the same way for the same reason).
**RED-proven without mocks:** core's `saveCredential` honors `ANVIL_HOME`, so the test
points it at a path under a *file* — the write fails with ENOTDIR deterministically
on every platform (chmod games would not bind for root), and the suite exercises the
real write path in both directions (failure shows the error and stays on the key
step; success writes the file).

**2. Guardian family labels are now compile-time bound
(`components/GuardianReportCard.tsx`).** `FAMILY_LABELS` was `Record<string, string>`
with a silent fallback, so a family added in `guardian/scanner.ts` would render as
its raw id. It is now `Record<GuardianRuleFamily, string>` (core's exported union)
with a runtime narrowing for cross-version reports. **Proof:** temporarily adding a
family to core's union failed the TUI typecheck at the map (`Property
'experimental' is missing`), then core was restored byte-identical.

**3. Reclassified — the tool-card JSON fallback needs no sanitize
(`components/ToolCallView.tsx`).** I flagged the missing `sanitizeTerminalText` on the
`JSON.stringify` branch and "fixed" it; the test passed, which is exactly why I then
verified the premise: `JSON.stringify` escapes every control character itself (ESC →
`\u001b`, CR → `\r`), so no raw byte can ever reach the frame and my fix was a
no-op. Code reverted, a comment records the invariant, and the new test pins the
*property* (no raw ESC/CR in the frame) rather than the mechanism — so replacing
`JSON.stringify` with a manual join would now fail it.

**4. Reclassified — sub-agent progress binds to the FIRST running sub-agent
(`hooks/eventReducer.ts`).** With two sub-agents live, progress events attribute to
whichever started first. This is a limitation of core's event contract
(`subagent_progress` carries `{ tool, detail }` — no sub-agent id), not a TUI bug;
the durable fix is adding an id to the event, a cross-package contract change left
for its own decision.

**Audited clean (no defect):** `DiffModal` (tab sliding, async error path, copy,
side-by-side toggle), `MissionDeck` (milestone windowing), `RewindModal` (sliding
window, empty state), `ThemePicker` (live preview contract), `VerificationCard`,
`index.ts` barrel, `eventReducer` retention caps (`OUTPUT_RETAIN_MAX`, per-string
cap, `TRANSCRIPT_STATE_CAP`).

**Evidence:** core 667 / tui 255 / cli 78 green; full `npm run gate` green (Steps
0–5, 15/15 mock evals). Note: the gate's Step 2 build typechecks TEST files too
(`tsc -p .`), unlike `npm run typecheck` — a missing required prop in a new test
fixture passed typecheck and failed the build until fixed.

---

## 2026-09-22 — TUI audit, pass 2: handlers + TTY guards (Buffy)

**1. `/mcp reconnect` silently deleted every plugin tool (`commands/handlers/mcp.ts`).**
The handler rebuilt the session's tool list as `[...TOOL_DEFINITIONS, ...keptMcp]`, but
CLI boot wires `[...TOOL_DEFINITIONS, ...pluginDefs, ...mcpDefs]` — so a plugin user who
ran `/mcp reconnect` lost all plugin tools for the rest of the session and the model
could no longer call them, with no notice. Fixed as a read-modify-write: core's
`AgentSession` gained `getTools()` (the read side `setTools` never had), and the handler
now filters the MCP entries out of the CURRENT list and appends the refreshed ones —
robust against a third tool source being added later. **RED-proven** (plugin tool
vanishes → present, verified by name in the resulting tool list).

**2. Two TTY guards failed OPEN on real pipes (`util/clipboard.ts`, `util/notify.ts`).**
Both tested `stream.isTTY === false`, but Node reports `isTTY` as **undefined** — not
`false` — on a redirected stream, so `node app.js 2>log` sailed past the guard and wrote
raw BEL / OSC 52 escape sequences into the user's log, reporting success. `altScreen.ts`
already used the correct `isTTY !== true` form; these two were the outliers. Both now fail
closed. **RED-proven** on both (the local test helpers could express `undefined` — they
just never did; the suites only ever passed explicit `true`/`false`, i.e. the author's
belief about what a pipe looks like rather than what Node actually reports).

**3. `/copy` could not see blocks the transcript renders (`commands/handlers/clipboard.ts`).**
`findLastCodeBlock` matched the language tag with `\w*` while `renderMarkdown`'s fence uses
`[^\s`]*`, so a `c++` or `objective-c` block is displayed as code but `/copy` reported
"no fenced code block in the transcript yet". Pattern aligned with the parser.
**RED-proven** (`null` → the block).

**Also:** a parity guard for the last two hand-maintained provider mirrors
(`util/providers.ts` `PROVIDER_META`, `util/labels.ts` — marketing copy can't be derived,
but completeness can): every registry provider must appear in both, exactly once, with its
own credential `field`. **RED-proven** by deleting a row. And one comment fix:
`ContextGauge` said "steady red" off-phase where the code uses amber.

**Audited clean (no defect):** `util/{rewind,subagent,mcp,providers,labels,chrome,useSpinner}.ts`,
`theme/adaptive.ts`, `hooks/useThemeManager.ts`,
`commands/handlers/{diff,rewind,session,sync,goal,phase25}.ts`,
`components/{StatusBar,ContextGauge}.tsx` (width accounting in cells, adaptive variants).

**Noted, not fixed:** `util/subagent.ts` `retainReport` slices by UTF-16 code unit, so a
report truncated mid-emoji can end in a lone surrogate (display copy only);
`chrome.meter` throws on a negative width (unreachable — its only caller passes 6 or 10);
`StatusBar` budget counts the sparkline even when it isn't rendered (unknown model).

**Evidence:** core 667 / tui 252 / cli 78 green; typecheck 0 across all workspaces (it
caught a missing `timeoutMs` in a new test fixture that vitest alone would not have);
full `npm run gate` green (Steps 0–5, 15/15 mock evals).

---

## 2026-09-22 — TUI audit (Buffy)

Second pass over the surface the first sweep had not opened: every `diff/` and
`util/` module, the markdown pipeline, the command registry + handlers, the theme
loader, `InputBar`, `App`, `MessageList`/`MessageView`, and the permission path.

**1. Markdown tables padded wide cells as if they were 1 cell
(`markdown/MarkdownView.tsx`).** A local `cellWidth()` counted CODE POINTS while
`util/format.ts` already exported the terminal-CELL `displayWidth`. "中文" is 2
code points but 4 cells, so every CJK/emoji cell was padded one cell short per
wide char and the `│` separators sheared apart. Worse, the local helper's own
comment claimed "CJK/emoji safety" — it guarded against `String#length` (surrogate
pairs) instead of the failure that actually occurs. **RED-proven** (2 distinct
separator columns → 1). This is the `§1.4 check existing helpers first` failure
mode: a second, wrong width function next to the right one.

**2. `BUILTINS` was a hand-kept mirror of `ThemeName` (`theme/custom.ts`).** Adding
a built-in theme would silently leave the shadow guard behind, letting a custom
theme of that name load — after which `isThemeName` would call the shadow
built-in. Derived from `Object.keys(THEMES)` now, so it cannot drift. Latent, not
live (the five names currently match).

**3. The image guard guarded nothing (`commands/handlers/media.ts`).**
`/image <path>` read the whole file with `readFileSync` and only then compared the
buffer to `IMAGE_MAX_BYTES`, so a 2 GB file (or `/dev/zero`) allocated unbounded
memory before the cap could fire. Now `statSync` decides first; the post-read
check stays as the backstop for special files (size 0). **RED-proven** — the test
asserts `readFileSync` is never CALLED for an oversize file, not merely that the
refusal message appears.

**4. A comment told maintainers to recover with `/save` (`hooks/useSessionCommands.ts`).**
No such command exists (the registry has 20, `/save` is not one). Corrected to the
real recovery path: the previous save is still on disk and the next settled turn
retries the write.

**Rejected a fix after testing it.** I suspected the diff gutter (`diff/colorizeDiff.tsx`)
misaligned `│` on added lines and changed it — the alignment test I wrote failed
immediately, falsifying the hypothesis. My repro had been unfaithful to the source
(typed `" │ "` where the code has `"     │ "`), and the original three literals do
align once each row's 1-char sign is counted. My edit was reverted; the test stays,
because it pins exactly the invariant I was about to break, and an explanatory
comment now records why the literals look asymmetric but are not.

**Audited clean (no defect):** `diff/{parseDiff,wordDiff,sideBySide}.ts`,
`util/{format,wrapSpans,sanitize,grouping,displayLimits,ledger,toolOutput,braille,errors,chrome}.ts`,
`markdown/{renderMarkdown,highlightCodeBlocks}.ts`, `commands/{registry,palette}.ts`,
`handlers/{diff,rewind,session}.ts`, `hooks/{useWindowedList,usePermissionBroker}.ts`,
`theme/{themes,theme}.ts`, `permission/TuiPermissionBroker.ts`, `components/{InputBar,MessageList,MessageView}.tsx`,
`theme/custom.ts` validation (semantic-color rejection path).

**Noted, deliberately not fixed (judgment, not oversight):** `wrapSpans` and the
transcript estimator both measure in code points and are therefore *self-consistent*
(changing one alone would make the "… N earlier messages" count lie); `chrome.meter`
throws on a negative width but its only caller passes 6 or 10; `/copy` is the one
command without a `COMMAND_ICONS` entry (the dot is the documented fallback);
`ColorizedDiff`'s `useMemo` is keyed on a fresh `slice()` and so recomputes every render.

**Evidence:** core 667 / tui 243 / cli 78 green; typecheck 0; full `npm run gate`
green (Steps 0–5, 15/15 mock evals).

---

## 2026-09-22 — Audit of the unaudited surface: 3 real defects fixed (Buffy)

Same method as the earlier passes: read the modules no one had read, fix only what
is actually broken, and say so when a module is clean.

**1. Anthropic collapsed malformed tool JSON to `{}` (`providers/anthropic.ts`).**
`translateAnthropicStream` had its own `try/catch` at `content_block_stop` while
`providers/streaming.ts` already carried the `{ __parseError, rawInput }` sentinel —
so on Anthropic (a top-3 provider) a malformed tool-arguments buffer became `{}`,
letting all-optional tools run on invented defaults while the model was never told
its JSON was broken. That is exactly the 22.2 regression the sentinel exists to
prevent, documented as FIXED in `docs/PHASE-21-25-AUDIT.md`. Root cause was
copy-paste: the sentinel was hand-built in three places and the third drifted.
Fix: one `parseToolCallJson()` in `streaming.ts` + `TOOL_CALL_RAW_INPUT_CAP` in
`config/constants.ts` (the duplicated `200` was a raw magic constant), now used by
`streaming.drain()`, `turnStream.ts` and `anthropic.ts`. **RED-proven.**
OpenAI was already correct (`ToolCallAssembler`); Gemini passes parsed args.

**2. `enterAltScreen` ignored the environment (`cli/src/altScreen.ts`).** It called
`isAltScreenSupported(stream, {})` with a literal empty env, so **both documented
opt-outs — `TERM=dumb` and `ANVIL_NO_ALT_SCREEN=1`, named in `--help` and in the
boot comment — were inert in production**: a TTY always switched buffers. The
predicate's own unit tests passed the env explicitly, so they never caught it.
Fix: env is a parameter defaulting to `process.env`; test now drives the opt-out
**through `enterAltScreen`**. **RED-proven.**

**3. MCP permission prompt named the wrong server (`tui/…/PermissionPrompt.tsx`).**
`mcpServerOf` split on the *first* `__`, but `SERVER_ID_RE` (`/^[a-z0-9-_]{1,40}$/`)
permits `__` inside a server id, so for server `my__server` the consent prompt read
`[mcp:my] server__read_doc` — naming a process that never receives the data. The
table was ambiguous by construction (tool names keep `__` too, so last-split is no
better). Fix: `splitMcpToolName(name, knownServerIds)` now lives next to
`mcpToolName` in core as the codec's single source of truth and picks the longest
known id; the TUI prompt forwards the configured ids from App. Display-only — the
executor routes by re-encoding and comparing, so execution was never affected.
**RED-proven.**

**Audited clean (no defect):** `permission/TuiPermissionBroker.ts` (FIFO queue,
drain-before-resolve abort path, abort-handler lifecycle), `components/App.tsx`
(overlay precedence, resize handling, the deliberate `rows - 1` Ink frame),
`MessageList`/`MessageView` (transcript clipping + control-char sanitizing),
`providers/openai.ts`, `providers/gemini.ts`, `cli/{health,initGuarded,goalRunner}.ts`.

**Evidence:** core 667 / tui 234 / cli 78 tests green; typecheck 0 across all
workspaces; full `npm run gate` green (Steps 0–5, 15/15 mock evals).

---

## 2026-09-21 — Full-gate red → green: LSP didOpen/didChange flake (OpenCode)

- Full `npm run gate` failed at Step 4: `lspclientEdges.test.ts` "sends didOpen
  once, then didChange with a bumped version on re-sync" — expected 2 didChange,
  got 1. Prod `lsp/client.ts:193-210` verified correct by reading (1 didOpen + 2
  didChange, fire-and-forget `stdin.write`); the test waited only for the FIRST
  didChange (`log.includes`, 500ms) then asserted two, so under full-suite load
  the second notification lagged the read. Test-only race, disjoint from the
  26.3–26.5 dirty tree (no lsp file in it).
- Fix (test-only, existing `waitFor` helper reused): predicate waits for the full
  `1 didOpen + 2 didChange` sequence, budget 500ms → 2000ms (matches the file's
  existing timeouts). Isolated file 5/5 green; quick gate green; full
  `npm run gate` green (Steps 0–5, 15/15 mock evals).
- No protected artifact touched. Also corrected the `guardianToggle.test.ts`
  path in Buffy's ownership block (lives under `agent/__tests__/`, not
  `guardian/__tests__/`).

## 2026-09-21 — 26.3 live delta attempt: one valid OFF lane, honest null (Buffy)

- Ran the live matrix lanes. **OFF lane complete & valid:** cohere/north-mini-code:free
  86.7% (13/15), 83k tokens. **ON lane impossible today:** OpenRouter `free-models-per-day`
  cap hit (account-wide; nemotron probe same 429) + Gemini free tier 429 + no frontier keys.
- Recorded as HONEST NULL in PHASE-26-PROGRESS; refused to publish "86.7% OFF vs 0% ON" —
  the ON lane spent 0 tokens, the model was never reached.
- **Pairing hardened against both live failure modes:** half-alive reports unpairsble
  (fewer than half the tasks spent tokens) + same-task-set requirement for both halves.
  Found via a stale-dist probe that paired the dead ON lane and printed "−86.7 pts —
  guardian hurts" from an outage. guardianFlag.test.ts 14/14 (+3). Deepseek free model is
  paid-only now; current free+tools catalog probed (19 models, 2 validated).

## 2026-09-21 — Phase 26.5 codebase health telemetry (Buffy, continuation)

- **`guardian/health.ts` (NEW):** per-project snapshot under `ANVIL_HOME/health/<12-char
  SHA-256 of resolved root>.json`, written synchronously via `atomicWriteJson` at `0600`.
  Schema: version, timestamp, resolved root, cumulative `scansRun`/`scannedLines`/
  `cleanLines`/`blockedByRule`, allowlist `entries` + `allowlistHigh` (MAX ratchet).
  Latest-only per project; corrupted snapshots discarded and rebuilt, never trusted;
  recording is best-effort (read-only home warns, never fails the scan).
- **Bug found by my own test run:** the first implementation used
  `void atomicWriteText(...)` — fire-and-forget async — which raced the read-back and could
  be lost at process exit. Fixed to synchronous `atomicWriteJson`.
- **CLI:** every real `gate`/`gate --staged` scan records one observation; `--watch`
  records ONCE at stop (per-rescan recording would inflate counters). `anvil health`
  (NEW `packages/cli/src/health.ts` + dispatch + help line) renders freshness, cleanliness,
  drain percent, top rules; honest empty states for both "no scans" and "no allowlist
  history".
- **End-to-end through the built CLI:** two `gate --staged` sessions on a throwaway repo →
  "2 scan(s) recorded", cleanliness 50%→60%, `no-as-any: 2`. RED proven by stubbing the
  recorder.
- **Tests:** `guardian/__tests__/health.test.ts` (NEW, 11). **Evidence:** core **638/638**
  green; core + cli `tsc` 0; full gate green at end of turn.

## 2026-09-21 — Phase 26.4 guarded init for foreign agents (Buffy, continuation)

- **`guardedInit` provisions a real gate now:** language-tailored AGENTS.md + `.anvil/rules`
  starter block (per-language slop idioms in `guardian:rules` format) + executable
  `.githooks/pre-commit` (dependency-free node/CJS script, git + node stdlib only) +
  `core.hooksPath` in the repo git config. Existing files/hooksPath never clobbered.
- **Hook design (embedded, not imported):** scans STAGED additions (`git diff --cached`,
  node_modules/dist excluded); enforces the two universal rules + the project's own
  `guardian:rules` block (same entry format as core's parser); exempts its own rule-source
  files (hook/rules/AGENTS.md) from ALL matching — a file defining a rule never "uses" it
  (S5.3 embedded); skips comment lines; allows empty commits; missing git → clear
  `[anvil-guardian]` failure naming `--no-verify` as the bypass (the no-Anvil degradation
  contract, sharpened: the hook needs NO Anvil install, so only git can be missing).
- **Acceptance = real commits in throwaway non-Anvil repos:** planted `as any` blocked
  (exit non-zero, `rev-list` 0, rule named on stderr), clean commit passes, `--allow-empty`
  passes, Python bare-except blocked via project rules, 4-language matrix, no-overwrite,
  isolated-PATH git-missing test. RED proven: hook provisioning stubbed → 8/10 fail.
- **CLI parity:** `scanStaged` + `anvil gate --staged` (same staged pathspec); both gate
  surfaces now load project `guardian:rules` (user rules are enforcement in the CLI lane).
- **Honest deviation recorded in PHASE-26-PROGRESS:** the spec's degradation copy said the
  hook should demand `@anvil/cli` in PATH; the embedded scanner is strictly stronger (works
  on hosts that never installed Anvil) — degradation is now "git missing".
- **Files:** `guardian/hook.ts` (NEW), `guardian/langRules.ts` (NEW), `guardian/init.ts`
  (rewritten), `guardian/index.ts` (exports), `cli/gate.ts`, `cli/index.tsx`.
- **Evidence:** core **627/627** green (was 617; +10, zero regressions); core `tsc` 0;
  cli `tsc` 0. Full gate run at end of turn.

## 2026-09-21 — S7 boxes ticked + Phase 26.3 harness (Buffy, continuation)

- **S7 MCP/LSP/goal-engine boxes ticked** in `docs/STABILIZATION-ROADMAP-2026-09.md` with
  evidence — the tests landed in the prior commit (`10faf88`); only the annotations were
  missing. Verified live before ticking: focused run 119/119 across mcp/lsp/goal/turnStream/session.
- **26.3 guardian toggle (harness half of the proof matrix):**
  - `AgentOptions.guardian?: boolean` (default ON). `false` short-circuits
    `guardianIntercept` — no scan, no block, no auto-fix. Sub-agents inherit through
    `ToolSessionContext.guardian` → `runSubAgentLive` (both delegate paths), so delegation
    cannot become a guardian bypass.
  - RED proven by neutralizing the skip (`if (false && …)`): the two opt-out tests failed
    (session blocked + auto-fixed as usual), the default-ON test kept passing. GREEN with the
    real guard. `guardianToggle.test.ts` 3/3.
  - **Eval wiring:** `evals/run.ts` `--guardian=on|off` + env `ANVIL_EVAL_GUARDIAN` (default on;
    invalid value → exit 1); banner states the mode; `runAllEvalTasks` seeds every task session;
    `EvalReport.guardian` records it (unset legacy → ON). `--report` prints the new
    GUARDIAN DELTA section: `formatGuardianDelta` ("Delta unavailable" for a missing half,
    "no delta" / "guardian hurts" named honestly) + `findGuardianDeltaPair` (newest on/off
    pair, fieldless legacy reports excluded, optional provider/model filter).
  - **Pacing:** `betweenTaskDelayMs` sleeps between tasks, never after the last one; default
    from `EVAL_RATE_LIMIT_DELAY_MS` (env `ANVIL_EVAL_RATE_LIMIT_DELAY_MS`, 2000ms), live lanes
    only — mock stays instant. Pinned by a timing test (exactly one inter-task gap).
  - `guardianFlag.test.ts` 11/11 (report layer, pairing, seeding, pacing, end-to-end smoke).
  - **Smoke-tested the real CLI lane:** `--mock` banner ON; `--guardian=off` and
    `ANVIL_EVAL_GUARDIAN=off` both banner OFF; `--guardian=bogus` rejected; `--report` renders
    the delta section.
- **Evidence:** core **617/617 (84 files)** green (was 603; +14 new, zero regressions); core
  `tsc` 0; **full `npm run gate` green** (0–5, evals 15/15). No protected artifact touched.

## 2026-09-21 — turnStream split + S7 MCP/LSP/goal tests landed (this session — Cline, takeover)
## 2026-09-21 — turnStream split + S7 MCP/LSP/goal tests landed (this session — Cline, takeover)

- Took over Buffy's half-done work (out of credit ~02:24): the `turnStream.ts` extraction was
  complete on disk but uncommitted, with 5 new S7 test files + goal test edits.
- `packages/core/src/agent/turnStream.ts` (NEW, 140 lines) — `streamAssistantTurn(input)` owns the
  provider-streaming contract (text accumulation, tool-call assembly from deltas, malformed-JSON
  `__parseError`, usage via `onUsage`, rate-limit retry via `TurnState`). `session.ts` keeps a thin
  delegate wrapper (~20 lines vs ~100 inlined); the only behavior-neutral rename is the wrapper
  method. Verified: core `tsc` clean, turnStream 9/9, session 14/14, cancelHistory 2/2.
- S7 tests (NEW/edited, all green): `mcp/clientUnit` + `mcp/clientReconnect`, `lsp/lspclientEdges`
  (timeout/crash honesty with real child processes) + `lsp/lspToolsLsp`, goal `awareness` (+33)
  + `goalEngine` (+125, incl. verify-failed-then-repaired milestone case).
- **Evidence:** full core suite **603/603 (82 files)** green. No protected artifact touched.
  Goal diffs are test-files-only (no prod `goal/` change).

## 2026-09-21 — S6 cancel-queue UX done (this session — Cline)

- `packages/tui/src/hooks/useAgentController.ts` — `runTurn: (text) => Promise<{cancelled}>`;
  `cancelled` observed from the engine's `cancelled` event; `send()` holds `queueRef` on a
  cancelled turn + `printSystemMessage("Turn cancelled — N queued message(s) held, not sent…")`;
  normal completion still `drainQueue()`s silently. HOLD per operator (CLEAR would drop intent).
- `packages/tui/src/hooks/__tests__/useAgentController.test.tsx` — +2 (`S6 cancel-queue UX`
  describe): cancel-hold + announce via a signal-aware hanging provider; normal-completion
  no-notice guard. 15 → 17 in file.
- `docs/STABILIZATION-ROADMAP-2026-09.md` — S6 cancel-queue box ticked with evidence.
- `CHANGELOG.md` — `### Cancelled Turns Hold the Message Queue…` entry under Unreleased.
- **Evidence:** TUI `tsc -p . --noEmit` exit 0; full TUI `vitest run` 232/232 (40 files).
  No protected artifact touched; no `packages/core`, scripts, or config files touched.
  Depends only on the `cancelled` event shape — survives the parallel
  `SessionLedger`/`RewindRing` extraction (verified: their `rewindRing.ts` re-emits it).

## 2026-09-21 — Certification provenance: certifiedMode (Buffy)

**Agent (this session)** — owns & changed:
- `packages/core/src/providers/types.ts` — `ModelInfo.certifiedMode?: "mock" | "live"`.
- `packages/core/src/providers/registry.ts` — every 2026-09-10 entry (mock batch) is
  `certifiedMode: "mock"`; `gemini-3.6-flash` + `gemini-2.0-flash` are `"live"` (probe), with the
  former's `certifiedAt` aligned to 2026-09-18; `setModelCertification` takes an optional mode and
  only overwrites when supplied.
- `packages/core/src/cert/runner.ts` — records `options.mock ? "mock" : "live"`.
- `scripts/certify-provider.ts` — passes `mock` into `certifyProvider`; summary badge is now
  "MOCK (Certified)" in mock mode.
- `packages/tui/src/util/format.ts` — `formatCertificationBadge(certified, mode)`; unrecorded mode
  defaults to `mock`. `ModelPicker.tsx` uses it (removes the inline copy that made the helper a
  dead export) and dims a mock badge.
- Tests: `providers/__tests__/registry.test.ts` (NEW, +3 provenance guards), `format.test.ts`
  updated for the mode dimension.
- Docs: README note + roadmap S6 note.

**Evidence:** core 554 / tui 233 / cli 51 all green; full `npm run gate` green.

## 2026-09-21 — S7 CLI coverage raised (Buffy)

**Agent (this session)** — owns & changed:
- NEW `packages/cli/src/__tests__/readStdin.test.ts` (+5) — non-TTY branches of `readStdin` with a
  stand-in stdin stream: end, byte cap (truncates + notices), idle window (destroys + continues),
  stream error, hard timeout. `headless.ts` coverage **36.6% → 91.5%**.
- NEW `packages/cli/src/__tests__/gate.native.test.ts` (+3) — `runNativeGate` in a temp git repo:
  clean tree → 0, planted universal slop → 1 (lists the violation), no-git → 1. `gate.ts`
  coverage **46.9% → 58.0%**.
- `packages/cli/src/__tests__/goalRunner.test.ts` (+1) — a throwing provider exits 1 cleanly. It
  found that the engine contains the provider error and reports `goal_failed`, so the runner's own
  catch is not reached; the assertion records the real behavior.
- `docs/STABILIZATION-ROADMAP-2026-09.md` — S7 CLI-coverage note; `CHANGELOG.md` records it.

**Result:** `packages/cli` **33.86% → 44.02% statements** (branches 33.78 → 37.16). Remaining
ceiling is `index.tsx` at 0% (514-line interactive entry; needs an Ink/process.exit harness) —
recorded, not hidden. MCP/LSP/goal-engine S7 items remain open.

## 2026-09-21 — S6 product truth finished (Buffy)

**Agent (this session)** — owns & changed. Skip note: the S6 cancel-queue box was already done by
Cline above; I did the three docs/coverage-honesty boxes.
- `packages/core/src/agent/rewindRing.ts`, `agent/session.ts` — `RewindRing` counts
  `baselineDroppedPaths` + `ringDroppedCheckpoints`; `AgentSession.diffCoverage()` exposes them.
- `packages/tui/src/components/DiffModal.tsx`, `commands/handlers/diff.ts` — both `/diff` surfaces
  render a "Review incomplete" warning when either counter is non-zero. Ring eviction is phrased as
  `/rewind` undo depth (it does not narrow `/diff`; the baseline is ring-independent).
- Tests: `rewindRing.test.ts` +1 (both counters fire), `cockpitModals.test.tsx` +1 (banner) and the
  mock now stubs `diffCoverage`.
- `README.md` — certification Status column is now `mock · 2026-09-10` / `live · 2026-09-18` (the
  BASIS), with the note paragraph corrected. Picker badge untouched (no `certifiedMode` field yet) —
  recorded as a known gap.
- `docs/STABILIZATION-ROADMAP-2026-09.md` — S6's remaining three boxes ticked; the 34,006-LOC
  figure recounted to **23,205 production lines / 182 files**. S6 is now complete.

**Collision note (honest):** committing `b54cc51` staged `CHANGELOG.md` + `PROGRESS.md` while Cline
had uncommitted DOCS edits in them, so their "Cancelled Turns" CHANGELOG section and ACTIVE PROGRESS
note rode into that commit (docs only — their `useAgentController` code was verified unstaged first
and remains so). Recording it so the next committer knows to stage those two files by explicit
hunks, not wholesale.

## 2026-09-21 — S5.3 precision + S7 coverage + session.ts ledger/rewind extraction (Buffy)

**Agent (this session)** — owns & changed. Disjoint from the Cline S6 cancel-queue work above;
no shared file.

**S5.3 — code rules no longer match comment text.**
- `packages/core/src/guardian/scanner.ts` — `isCommentLine` skips comment lines for every built-in
  family EXCEPT `no-placeholder-marker` (a marker word in a comment is what that rule exists to
  catch). `isCorePackageFile` scopes `no-architecture-breach` to `packages/core/` (S5.3's literal
  "resolve package membership first"); a path with no `packages/` prefix stays in scope so the rule
  is never silently dropped. Split-pattern pass skips comment pairs. `guardian.test.ts` +3
  (comment naming the boundary clean; real core to tui import fires; non-core package file not
  judged). 26 to 29.
- **PROTECTED (declared per AGENTS.md §3.4):** `scripts/verify-gate.mjs` (`isCommentLine` guard on
  Step 1 rules 1/1b/2/3/4/5 + multi-line pass, and Step 1.5 for all residual families except the
  placeholder marker); `packages/cli/src/__tests__/gate.sentinel.test.ts` (+1 assertion pinning
  `isCommentLine`/`lineIsComment` and the placeholder exemption); `.githooks/pre-commit` (code rules
  scan a comment-filtered `$code` view; placeholder keeps full text; word-boundary fix on the
  type-escape grep — the exact "was never" miss); `scripts/gate-manifest.json` regenerated for the
  three changed protected files. Verified: sentinel 12/12; `npm run gate -- --quick
  --ack-protected-change` green. Requirement (c) — explicit human review of the protected diff —
  is the operator's; the ack flag is the acknowledgement.
- The gate caught this session writing a literal placeholder token in its own new comments
  (correct behavior — reworded).

**S7 — coverage reporting (opt-in, does not gate).** `@vitest/coverage-v8@4.1.11` at root;
coverage blocks in core/tui/cli `vitest.config.ts` (include `src/**`, exclude tests); `coverage`
scripts per workspace + root `npm run coverage`. First core baseline: **85.03% stmts / 87.06%
lines / 74.86% branches / 87.46% funcs**.

**session.ts extraction.** New `agent/sessionLedger.ts` (`SessionLedger`) and `agent/rewindRing.ts`
(`RewindRing`); `session.ts` delegates to both, keeping only the prepared-calls to paths and
succeeded to commit translation. **1000 to 872 lines.** Tests: `sessionLedger.test.ts` +4;
`rewindRing.test.ts` +1 (baseline bounds moved out of `rewind.test.ts`, which reached into
now-moved privates). Core suite 546 green; core typecheck 0; full gate green.

## 2026-09-21 — Operator-authorized commit of the OpenCode TUI scroll work + README truth fix

**Agent (this session)** — owns & changed:
- The 7 TUI transcript-scroll files previously owned by the stopped/hand-off "OpenCode session
  (scroll-first)" were **committed as-is** (`b02beb4`) at the operator's explicit request, after the
  full `npm run gate` passed with them on disk. No source was edited; this removes the
  one-disk-failure-from-loss risk PROGRESS.md had flagged.
- `README.md` §Safety — the checkpoint bullet no longer says "memory-only"; it now states the
  persisted per-session ring under `$ANVIL_HOME/checkpoints/`, the base64 raw-bytes/`0600`
  storage, `ANVIL_CHECKPOINT_KEEP`, and the S1.3 external-edit warning. Verified against
  `checkpointStore.ts` + `config/constants.ts`. Ticks the first S6 box in
  `docs/STABILIZATION-ROADMAP-2026-09.md`; `CHANGELOG.md` records it.
- `packages/core/src/agent/turnVerifier.ts` + `agent/session.ts` — **extracted the turn-terminal
  sequence** into an exported `finishTurn()` generator in the verification module. `send()` no
  longer inlines verify → cancel/repair/error/complete; it calls the seam and only owns the one
  bit the seam cannot see (`verifyRepairsUsed` bump on `"continue"`). Behavior-preserving: same
  event order, same ledger writes, same success bookkeeping. `send()` body 209 → ~180 lines.
- `packages/core/src/agent/__tests__/turnVerifier.test.ts` — +3 cases pinning the seam's three
  outcomes (clean close + `onSuccess`; declined turn is `error` not `turn_complete`; failed
  verification returns `continue` without closing). 6 → 9 tests.

**Evidence:** core build + typecheck exit 0; focused suite 9/9; full core suite 540/540; full
`npm run gate` green (0–5, incl. the new bare-any/architecture checks). No protected artifact
touched — no manifest/sentinel change required.

## 2026-09-20 — STABILIZATION §S2.3: compaction realism (2 real bugs found + fixed)

**Agent (this session)** — owns & changed:
- `packages/core/src/agent/compaction.ts` — two fixes. (1) `closeToolPairs` widens a selective-keep
  selection until no tool interaction is half-kept, so a kept `tool_result` can never outlive its
  summarized-away `tool_call`. (2) `mergeSummaryIntoHistory` generalized from "repair the first
  same-role pair" to "merge every adjacent same-role pair", with tool results ordered first inside a
  merged user turn; it still returns the input reference when nothing needs changing (the existing
  identity test pins that).
- `packages/core/src/agent/__tests__/compaction.test.ts` — +3: a seeded (deterministic LCG) property
  test over 60 generated histories × both option variants asserting role alternation and tool
  pairing in both directions; a selective-keep variant with a real keep budget; and the
  enormous-message boundary case. Coverage guards (`compactedRuns > 20`) keep the property test from
  passing vacuously, and the generator asserts its own output is shape-valid.
- `README.md` — the compaction bullet now describes the boundary as a deliberate no-op and states
  the guarantee the compactor provides.
- Docs: `docs/STABILIZATION-ROADMAP-2026-09.md` (S2.3 both boxes ticked with the probes recorded),
  `CHANGELOG.md`.

**Why this item mattered:** the roadmap framed S2.3 as "property test + document", i.e. expected
verification work. The test instead found two live defects in the `task`-driven path (the path the
session always takes, `task: turn.task`): an orphaned `tool_result` (seed 2) and consecutive
same-role messages (seed 1). Both were confirmed load-bearing by reverting each fix separately and
watching the specific failure return. Writing the test first is what made them visible — neither was
reachable from the existing tests, which only exercised the no-task path and short histories.

**Evidence (red → green):** RED 1 — `seed 1 options={"task":"parser"}: consecutive user at index
1/2`. RED 2 (after reverting only the pair fix) — `seed 2 options={"task":"parser"}: orphan
tool_result for call_4_2_0 at index 0`. GREEN — `compaction.test.ts` 18/18; full suite 811 tests
(core 540 / tui 230 / cli 41); `npm run typecheck` exit 0 across core+tui+cli+scripts; full
`npm run gate` green.

**Not a protected artifact** — no `AGENTS.md`/gate/manifest/allowlist/sentinel/CI path involved.
`docs/PHASE-21-25-AUDIT.md` deliberately untouched.

**Not mine, left alone:** the OpenCode session's TUI transcript-scroll files
(`packages/tui/src/{components/App,InputBar,MessageList}.tsx`, `util/transcriptWindow.ts`,
`util/displayLimits.ts` and their tests) remain un-staged and uncommitted by this session.


## 2026-09-20 — STABILIZATION §S1.3 (final box): /rewind reports outside edits

**Agent (this session)** — owns & changed:
- `packages/core/src/agent/checkpoints.ts` — `FileSnapshot.postHash` (fingerprint of the state the
  session left behind; `undefined` = never recorded, `null` = nothing readable there), `hashBytes`,
  `fingerprintPath`, `latestPostState` (the session's own last recorded state for a path), and
  `restoreCheckpoint(root, cp, sessionState?)` which now detects out-of-band edits BEFORE writing
  and returns `externallyModified: string[]`.
- `packages/core/src/agent/checkpointStore.ts` — persists `postHash` additively; the key is
  OMITTED when unknown so a legacy checkpoint is never misread as "the file was absent".
- `packages/core/src/agent/session.ts` — `commitRewindSnapshot` fingerprints each succeeded target
  at commit time (the only moment the post-mutation state exists); `rewind()` passes the whole ring
  and returns `externallyModified`.
- `packages/tui/src/util/rewind.ts` — **my ownership declared:** renders the warning line. This file
  is NOT in the OpenCode session's ownership list. `App.tsx` (which they DO own) needed no edit, and
  got none: the new result field is optional, so their `formatRewindResult(result)` call site is
  untouched.
- Tests: `packages/core/src/agent/__tests__/rewind.test.ts` (+5, in the existing
  "S1.3: checkpoints reflect reality" describe),
  `packages/core/src/agent/__tests__/persistentCheckpoints.test.ts` (+1 restart case),
  `packages/tui/src/util/__tests__/rewind.test.ts` (+2).
- Docs: `docs/STABILIZATION-ROADMAP-2026-09.md` (S1.3's last box ticked, with the deviation from
  the literal wording recorded and the legacy-checkpoint limit stated), `CHANGELOG.md`.

**Design note (why the shape is not the obvious one):** the roadmap asked to compare against "the
post-checkpoint state", which did not exist anywhere — the checkpoint stores only pre-mutation
bytes. Recording that state means a fingerprint at commit time. Comparing against the *restored
checkpoint's* fingerprint would misreport the session's own later writes as external edits on the
ordinary rewind-to-an-earlier-point flow, so the comparison is against the session's last recorded
state for that path (highest-id checkpoint carrying one). No fingerprint ⇒ no warning, deliberately:
a fabricated warning is worse than silence.

**Evidence (red → green):** 5 new `rewind.test.ts` cases failed first (2 failed/6 passed → 18/18 in
that file), 2 TUI renderer cases likewise (→ 5/5). Full suite 808 tests green (core 537 / tui 230 /
cli 41), `npm run typecheck` exit 0 across core+tui+cli+scripts, full `npm run gate` green.

**Not a protected artifact** — no `AGENTS.md`/gate/manifest/allowlist/sentinel/CI path involved.
`docs/PHASE-21-25-AUDIT.md` deliberately untouched.

**Not mine, left alone:** the OpenCode session's TUI transcript-scroll files
(`packages/tui/src/{components/App,InputBar,MessageList}.tsx`, `util/transcriptWindow.ts`,
`util/displayLimits.ts` and their tests) remain un-staged and uncommitted by this session.


## 2026-09-20 — STABILIZATION §S5: guardian scoping (F2)

**Agent (this session)** — owns & changed:
- `packages/core/src/guardian/scope.ts` — **NEW.** `detectGuardianScope(projectRoot)` returns
  `"anvil"` when the root is this monorepo (a `packages/core/package.json` declaring
  `@anvil/core`), else `"foreign"`; cached per root, never throws.
- `packages/core/src/guardian/scanner.ts` — every built-in rule (single-line and split-line)
  carries `scope: "universal" | "anvil"`; Anvil-only families are skipped unless the scan is
  `"anvil"`. Built-ins are also skipped for positively non-code extensions (`isNonCodePath`),
  while a name with no extension is still treated as code.
- `packages/core/src/guardian/interceptor.ts`, `guardian/index.ts` — `interceptTurn` takes the
  scope and forwards it; both symbols re-exported from the core barrel.
- `packages/core/src/agent/session.ts` — scope detected ONCE per session, passed to every turn
  intercept.
- `packages/cli/src/gate.ts` — the `anvil gate --watch` working-tree scan is scoped by project
  identity instead of assuming Anvil's rules.
- `packages/core/src/eval/runner.ts` — the harness pins `"anvil"`: it judges the agent against
  Anvil's conventions even though the scanned files live in a temp dir.
- Tests: `guardian/__tests__/guardian.test.ts` (+19: foreign-scope silence for Anvil families,
  universal families still firing, markdown-is-not-code, extensionless name still scanned,
  `detectGuardianScope` identity cases, split-line scope parity) and
  `agent/__tests__/guardianDispatch.test.ts` (fixture now writes the `@anvil/core` manifest and
  asserts the classification before each session, so a detector-contract change fails loudly
  instead of as a confusing auto-fix miss).
- Docs: `docs/STABILIZATION-ROADMAP-2026-09.md` (S5.1/S5.2 ticked with evidence and the
  identity-vs-opt-in deviation recorded; **S5.3 left UNCHECKED — the import rule is still
  regex-based**), `CHANGELOG.md`.

**How the stop was resumed:** the previous session left 2 failing tests in
`guardianDispatch.test.ts`. Diagnosis before touching anything: the fixtures used a bare temp
root, which under the new detector is `"foreign"` — where the raw-error auto-fix is *supposed* to
be silent, because it rewrites to an `@anvil/core` helper that does not exist in a user's
project. The fix was to make the fixture declare its identity, NOT to widen the rule back to
`universal` (that would reintroduce F2 and make the guardian inject undefined identifiers into
foreign code). Verified red→green: file went 2 failed/6 passed → 8/8.

**Also fixed in passing:** `packages/cli` typecheck failed on the missing `detectGuardianScope`
re-export purely because `packages/core/dist` was stale; rebuilt core (no source change).

**Evidence:** full `npm test` green — 800 tests, 121 files (core 531 / tui 228 / cli 41);
`npm run typecheck` exit 0 across core+tui+cli+scripts; full `npm run gate` green.

**Not a protected artifact** — no `AGENTS.md`/gate/manifest/allowlist/sentinel/CI path involved,
so no manifest work is required. `docs/PHASE-21-25-AUDIT.md` deliberately untouched.

**Not mine, left alone:** the TUI transcript scroll-pinning files
(`packages/tui/src/{components/App,InputBar,MessageList}.tsx`, `util/transcriptWindow.ts`,
`util/displayLimits.ts` and their tests) belong to the OpenCode session above and are **un-staged
and uncommitted** by this session.


## 2026-09-20 — OpenCode session (scroll-first)

**Owns (done, gate green):**
- `packages/tui/src/components/App.tsx` — transcript pin state + PgUp/PgDn input
- `packages/tui/src/components/MessageList.tsx` — `pinnedBack` render window + follow footer
- `packages/tui/src/components/InputBar.tsx` + `__tests__/input.test.tsx` — terminal-proof cursor (no inverse-video placeholder eat)
- `packages/tui/src/util/transcriptWindow.ts` — pure `applyTranscriptPin` helper
- `packages/tui/src/util/displayLimits.ts` — `TRANSCRIPT_SCROLL_PAGE` budget
- Tests: `packages/tui/src/util/__tests__/transcriptWindow.test.ts` (+3 pin cases, 8/8 green)
- Cursor fix: `InputBar.tsx` empty-field `█` block + `showCursor={value.length > 0}` (1 new test, 8/8 input green)
- Evidence: `npm run typecheck -w @anvil/tui` clean, full `npm run gate` green (15/15 mock evals)

## 2026-09-19

**Agent A (this session)** — owns & completed:
- Phase 26 declared: `docs/PHASE-26-SPEC.md` (Guardian Everywhere — productize the immune
  system: turn report UX, `anvil gate --watch`, model-agnostic proof matrix, guarded init
  for foreign agents, health telemetry) + initialized `docs/PHASE-26-PROGRESS.md`
  (NOT STARTED). Motivation: coding-agent CLIs are undifferentiated; Anvil's built-in
  anti-slop immune system is the unique claim — verified live in this session
  (interceptor wired in the turn loop, `anvil gate` working outside the repo, live eval
  93.3% proving model-agnostic harness). Phase 26 makes that claim visible and measurable.
- Tag mapping resolved (v0.9.0/v0.9.1/v0.10.0 → `da15273`; v1.0.0 → `c2f342e`).



## 2026-09-18

**Agent A (Buffy / this session)** — owns & completed:
- `packages/core/src/providers/anthropic.ts` + `providers/__tests__/anthropic.test.ts` — usage now read from flat `message_delta.usage` (real SDK `RawMessageDeltaEvent` shape, cumulative `MessageDeltaUsage`); legacy `delta.usage` shape still tolerated; stream cast reduced to a single cast.
- `packages/core/src/providers/base.ts` — removed dead `streamWithRetry` (zero callers; constitution §2.8). Live retry path unchanged.
- `packages/core/src/tools/delegateTask.ts` + `agent/__tests__/teamBudget.test.ts` — team iteration budget now enforced: `runSubAgentLive` receives the `runTeam`-computed budget (per-member `maxInnerIterations` override clamped to `[1, total]`). Was `_budget`-ignored/unbounded.
- `packages/core/src/agent/session.ts` + rewritten `agent/__tests__/guardianDispatch.test.ts` — S1.1 single dispatch decision (see Agent B note below; lane taken over after that agent stopped).
- NEW files: `PROGRESS.md` (this note), `agent/__tests__/teamBudget.test.ts`, rewritten `guardianDispatch.test.ts`.
- `packages/core/src/agent/turnVerifier.ts` + `turnVerifier.test.ts` — S1.2: final repair is
  ALWAYS verified (budget exhaustion stops repair prompts, never verification). A passing final
  repair now reports `passed`; a still-failing final state reports `verification_gave_up` backed
  by a real probe. Updated `autoVerify.test.ts` expectations (3 probes bounded, no looping).
- `packages/core/src/agent/session.ts` + `rewind.test.ts` (S1.3 block) — cancel path commits the
  pending checkpoint for succeeded calls; `commitRewindSnapshot` filters file entries to
  write/edit targets whose calls actually succeeded.
- Deterministic cancellation test uses a hung permission broker (the orchestrator's abort race)
  instead of timing heuristics.
- `packages/core/src/providers/base.ts` + `providers/__tests__/base.test.ts` — S2.2 partial-stream
  retry semantics: no delta replay after a mid-stream error (`surfaced` flag gates catch-path
  retry); abandoned iterator explicitly closed (`iterator.return`) before first-event-error retry
  (fixture suspends at a `yield` so `.return()` deterministically runs its `finally`); backoff
  abortable via `sleepAbortable`. Hoisted `sleepAbortable` from `agent/session.ts` into
  `core/errors.ts` (shared helper; session now imports it).
- `docs/STABILIZATION-ROADMAP-2026-09.md` — annotated in place: S0 and S1.1–S1.3 and S2.1/S2.2
  checkboxes marked done with dated evidence; status header updated; S1.3 rewind external-edit
  warning and S1.4/S2.3/S3–S6 explicitly left open.

**Agent B (concurrent session — STOPPED mid-task 2026-09-18 ~02:00; lane taken over by Agent A with user approval)**:
- Left behind an untracked failing-first `guardianDispatch.test.ts` (S1.1 red test). Its fixture
  used raw-error formatting, which the guardian AUTO-FIXES by design — so the test asserted a
  block that could never happen, and its literal fixture string also tripped gate Step 1.
- Agent A rewrote the test file (non-fixable `as any` fixture built from split literals + three
  new cases: mixed-batch isolation, auto-fix happy path, loop-refused session-tool ordering) and
  implemented the S1.1 fix in `packages/core/src/agent/session.ts`:
  guardian-blocked call ids collected in a `guardianBlocked` set and skipped by the dispatch loop;
  `p.refused` checked BEFORE session-tool handling (a loop-refused delegate_task/update_plan no
  longer reaches its executor). 4/4 guardian tests green; full core suite green with zero
  regressions (478 tests, 72 files).
- Net effect: a guardian refusal (or loop refusal) can no longer diverge from actual execution —
  the approved → executed → changed → verified → reported chain agrees for refused calls.

**Disjointness guarantee:** no file is touched by both agents. Root `PROGRESS.md` did not exist;
created here per the constitution's coordination requirement.
---

## 2026-09-18 — Agent C (chief-engineer verification pass)

**Owns & changed (disjoint from Agents A/B — no shared file edited):**
- `packages/core/src/agent/goal/goalEngine.ts` — `verificationFailed` is now the
  **last** verdict instead of a sticky failure. In a single `send()` a repaired turn
  emits `verification_result(false)` → `verification_result(true)`; sticky failure
  marked such a milestone failed, so with S1.2's always-probe-final change a repair
  could never rescue a milestone. `verification_gave_up` stays terminal (emitted only
  when the final state still fails).
- `packages/core/src/providers/streaming.ts` — `ToolCallAssembler.drain()` no longer
  collapses unparseable tool-call args to `{}`. It emits the existing
  `{ __parseError, rawInput }` sentinel that `executeTool` (`tools/index.ts:94`) and
  the orchestrator (`orchestrator.ts:80`) already convert into a model-visible error.
  The OpenAI-shaped stream path previously made that handling unreachable.
- Tests (new/changed): `agent/goal/__tests__/goalEngine.test.ts` (+2 cases),
  `providers/__tests__/streaming.test.ts` (split the malformed case from the
  genuinely-empty case; the old assertion encoded the `{}` behavior).

**Roadmap item classification (AGENTS.md §1.5 — recorded here because the audit doc is
a protected artifact):** item **22.2 (malformed tool-call JSON → `{}`)** — the session
path already had provenance (`session.ts` `__parseError`); the *assembler* was the
remaining LIVE hole. Status: **LIVE → FIXED** for the assembler path. The audit doc
itself was NOT edited (protected; needs human review + manifest/sentinel sync).

**Test-first evidence:** both new tests were RED before the fix (`input: {}` vs
sentinel; `milestone_failed` present) and GREEN after. Full suite: **739 passed**
(cli 30 / core 486 / tui 223), zero regressions.

**Deliberately NOT staged:** `CHANGELOG.md` carries `+135` lines of another agent's
in-flight `[Unreleased]` WIP; my entry was added to the file but left unstaged so this
commit does not bundle their work (AGENTS.md §1.2 collision guard).

---

## 2026-09-18 — Agent C pass 2 (S1.4 + release hygiene)

**Owns & changed:**
- `packages/cli/src/terminalRenderer.ts` + `__tests__/terminalRenderer.test.ts` — **S1.4
  closed**. `verification_gave_up` returned no exit code; because it precedes
  `turn_complete` and `headless.ts` returns on the FIRST exit code it sees, a turn that
  mutated files and left tests failing exited **0**. It now returns `EXIT_UNVERIFIED` (3).
  All exit codes became named constants (`EXIT_OK/ERROR/BUDGET_EXHAUSTED/UNVERIFIED/
  CANCELLED`) replacing inline literals, and the misaligned `case` indentation was fixed.
  Three new tests: give-up nonzero, real headless event order exits 3 (not 0), repaired
  failure still exits 0. **Test-first: 2 RED (`expected undefined to deeply equal
  {exitCode:3}`; `expected +0 to be 3`) → 7/7 GREEN.** Typecheck 0; cli suite 33 (was 30).
- `docs/STABILIZATION-ROADMAP-2026-09.md` — S1.4 boxes annotated; exit-code table recorded
  there as the roadmap asked; the "no test runner detected → still 0" limitation stated
  rather than hidden. Status header updated (S1.4 no longer open).
- `CHANGELOG.md` — S1.4 entry.

**Release hygiene (verification, not assertion):**
- Landed the 120-file working-tree WIP in two commits (`d049b9c` code 129 files,
  `c2f342e` docs 10 files) — it had been validated but **uncommitted**, i.e. one disk
  failure from loss. Grouped coarse because the new subsystems are imported by the modified
  call sites (`session.ts`→`guardian/`, `tools/index.ts`→`lsp/`, `cli/index.tsx`→`gate.ts`);
  finer splits would break intermediate builds.
- Tagged the provable releases only: `v0.6.3`, `v0.7.0`, `v0.8.0`, `v0.11.0` (lightweight,
  matching existing tags). NOT tagged: `v0.9.0`/`v0.9.1`/`v0.10.0` (all squashed into
  `da15273` — tagging them would fabricate history) and `v1.0.0` (its heading is not in HEAD).
- **Pre-commit hook blocked the batch commit** on 4 false positives (`as any` inside a
  comment and inside test-fixture string literals whose purpose is to test the scanner).
  Fixed via the repo's own split-literal convention, runtime strings unchanged — did NOT use
  `--no-verify`.

**Blocked / needs a human:**
- **Push impossible from here**: `git ls-remote origin` fails with "could not read Username
  for 'https://github.com'" — no credentials in this environment. Network is fine
  (openrouter reaches 200). All commits + tags are LOCAL ONLY. Needs a token/credential
  helper or a manual push.
- ~~`v0.9.0`–`v0.10.0` tag mapping needs a human decision (squashed history).~~ **RESOLVED
  2026-09-19 (agent, delegated decision):** archaeology showed the 0.9.0/0.9.1/0.10.0/0.11.0
  CHANGELOG headings all entered in the single squash commit `da15273` — so `v0.9.0`,
  `v0.9.1`, `v0.10.0` were tagged there (the same three-release tree; `v0.11.0` already
  pointed at it). `v1.0.0` was tagged at `c2f342e`, not the Phase-25 code commit
  (`d049b9c`): the 1.0.0 heading only entered in `c2f342e`, and a release tree should be
  self-consistent — `package.json` 1.0.0 + a CHANGELOG that actually contains 1.0.0. All
  lightweight, matching the recent repo convention.
- Phase 25.7's last box (live eval ≥80% on a real provider) still open — keys exist for
  gemini/anthropic/openai/openrouter/orcarouter.

---

## 2026-09-18 — Agent C pass 3 (live eval attempt + certification rot)

**Attempted Phase 25.7's last checkbox (`npm run eval` on a real provider), at $0 via Gemini
free tier. Result: the box stays OPEN, but two durable things came out of it.**

- **The live lane works.** `npx tsx evals/run.ts --provider gemini --model gemini-3.6-flash`
  produced real agent turns: task `01-bugfix-calc-divzero` PASSED with **6 tool calls in
  24.7s**. So the harness's live path is functional, not just the mock path the gate uses.
- **A retired model was falsely certified `live`.** Probing the provider directly showed
  `gemini-2.0-flash` returns *"This model models/gemini-2.0-flash is no longer available.
  Please update your code to use models/gemini-3.6-flash."* — yet the registry carried
  `isFree: true` + `certified: "live"` (2026-09-10) and the README's certified table listed it.
  Fixed: `certified: "broken"` with the probe evidence inline; README updated; the remaining
  Gemini ids downgraded to "unverified" rather than assumed working. The model picker renders
  `[❌ broken]` from this field, so the badge was actively lying.
  Files: `packages/core/src/providers/registry.ts`, `README.md`.
- **The 1/15 score is INVALID as a quality signal — do not read it as one.** 3 tasks hit the
  harness's 30000ms per-task limit with **zero tool calls**, and 5 more failed in ~0.03s; the
  model was never reached (free-tier quota exhausted mid-run). Only task 01 had a genuine
  evaluation. Re-run on a key with real quota before drawing conclusions.
- Diagnostic note: a provider probe must live inside the repo (root `type: module`); a script
  under `/tmp` is treated as CJS and fails on top-level `await`. Probe removed after use —
  tree left clean.

---

## 2026-09-18 — Phase 25.7 CLOSED: live eval passes at 93.3% (14/15) on OpenRouter free tier

**The ≥80% live-eval box is CLOSED.** Same tasks, same harness, real provider — at $0.

- **Model:** `deepseek/deepseek-v4-flash-0731:free` via the `openrouter` adapter. Chosen from
  the live OpenRouter catalog: 445 models, 25 free, **21 free AND tool-capable**. Probed 3
  candidates with a real tool round-trip before committing to a full run; 2 returned valid
  tool calls, 1 was upstream-rate-limited (429). Key validated first via `/api/v1/key`
  (free tier, usage 0) — never echoing the key itself.
- **Result: 14/15 PASS (93.3%), 7m47s wall, 100% tool engagement.** Task times 11.8s–50.2s
  (median ~28s), 2–13 tool calls each. Every task used tools, so no silent no-op passes.
- **The blocker was ours, not the provider's.** First attempt failed only because the
  harness capped each task at 30s — a magic number that per-task `task.json` config
  *reiterated*, and per-task config wins in the runner. Task 01 once passed at **29.27s**,
  0.73s under the cap; the model was simply working when the clock killed it. Evidence the
  cap, not capability, was the constraint.
- **Harness fixes (this commit):** (1) both `30_000` literals in `runner.ts` replaced by
  `EVAL_TASK_TIMEOUT_MS` (env `ANVIL_EVAL_TIMEOUT_MS`, default 30s — no magic numbers, per
  repo convention); (2) `run.ts` passes that value as the runner's operator override, so an
  env-set timeout beats per-task config. Default CI behavior is unchanged — verified by
  re-running the mock lane: **still 15/15**.
- **Diagnostic:** my *polling* of the eval, not the eval itself, kept dying — `sleep 29`
  sat at the 30s shell-timeout edge. Operational footgun; poll with `sleep 25`.
- **Not a credit to dodge:** the one failure was `11-multifile-extract-interface` — a
  genuine 180s timeout after 13 tool calls, not an infra artifact. That task does more
  work than the model can finish in 3 minutes; it's a real capability gap, now measurable
  instead of hidden.
- **Files:** `packages/core/src/eval/runner.ts`, `packages/core/src/config/constants.ts`,
  `evals/run.ts`, `PROGRESS.md`, `CHANGELOG.md`, roadmap §25.7.

---

## 2026-09-19 — Chief-engineer review follow-ups (this session)

**Agent (this session)** — owns & changed (all non-protected; no protected artifact
touched, so no manifest/sentinel change required):
- `packages/core/src/guardian/interceptor.ts` — **guardian false-negative fixed.** The
auto-fix re-scan filter dropped raw-error violations that *survived* repair whenever the
fix budget was unspent (`v.rule !== "no-raw-error-format" || fixesUsed >= GUARDIAN_MAX_AUTO_FIXES`),
so a turn carrying an unfixable fallback shape (e.g. `… ? err.message : JSON.stringify(err)`)
was silently allowed. The dead `remaining` accumulator is gone; repairs now re-scan and only
vanishing (fixed) occurrences drop out, so survivors block.
- `packages/core/src/guardian/scanner.ts` — `no-hardcoded-color` repair text pointed the
model at `useTheme() from @anvil/core`; `useTheme()` lives in `@anvil/tui`. Corrected via the
file's existing `TUI_PACKAGE` split literal (a raw `@anvil/tui` in a core file is itself a
gate violation).
- `packages/core/src/tools/types.ts` + `agent/types.ts` — **typed the session-tool seam.**
`ToolSessionContext` no longer exposes `provider: unknown` / `permissionBroker: unknown` /
`recordLedger(entry: unknown)`; `SessionToolExecutor` yields `AgentEvent`, not `any`.
Removed the resulting casts in `agent/session.ts` and `tools/delegateTask.ts`.
- `packages/core/src/tools/updatePlan.ts`, `tools/delegateTask.ts` — `AsyncGenerator<any, …>`
→ `AsyncGenerator<AgentEvent, ToolExecutionResult>`.
- `packages/core/src/providers/freeModels.ts` — `Array<any>` → new `OrcarouterCatalogModel`
interface (roadmap item 24.4 had regressed).
- `packages/core/src/agent/goal/goalEngine.ts` — `(m: any, idx)` → `unknown` + narrowing.
- Tests: `guardian/__tests__/guardian.test.ts` (+1: unfixable raw-error violation must block).

**Classification (AGENTS.md §1.5):** roadmap 24.4 (replace `Array<any>`) and 24.12
(session `send()` < 300 lines) were marked `[x]` but had **regressed / were overstated** —
`Array<any>` and bare `any` annotations were live. 24.4 code sites are FIXED here. 24.12
remains LIVE (see note below). The protected audit doc was **not** edited.

**Protected-artifact change (AGENTS.md §3.4 — declared here per requirement (a)):** the
gate blind spot is now CLOSED. `scripts/verify-gate.mjs` Step 1 gains Rule 1b and Step 1.5
gains a matching residual rule for **bare `any` annotations** (`: any`, `<any>`, `any[]`),
which the cast-only `\bas\s+(any|never)\b` rule could not see. The pattern carries a
`(?<!\?)` guard so `(?:any` non-capturing groups are not misread as annotations (caught by
Step 1.5 on `guardian/scanner.ts` during development). The Step 0 sensor gained a bare-any
fixture (threshold 7 → 8). Files changed:
`scripts/verify-gate.mjs`, `scripts/gate-manifest.json` (both changed hashes regenerated),
`packages/cli/src/__tests__/gate.sentinel.test.ts` (asserts the new rule + residual rule
name, kept in sync). Verification: `npm run gate -- --ack-protected-change` fully green
(0–1.5, build, typecheck, all tests incl. the sentinel, 15/15 evals). Requirement (c),
explicit human review of this protected-path diff, is on the operator — the
`--ack-protected-change` flag is the acknowledgement and is carried only by that command,
never by the pre-commit hook.

**Known remaining (LIVE):** `AgentSession.send()` is still ~525 lines mixing compaction,
loop-guard, guardian, orchestration, checkpointing, verification, history, and ledger — the
24.12 <300-line target is not met. Flagged, not refactored in this pass (blast radius).

**Evidence:** `npm run typecheck` 0 errors (core/tui/cli + scripts); full suite 223 tui tests
plus core/cli green (exit 0); `node scripts/verify-gate.mjs --quick` clean; after the gate
change, `npm run gate -- --ack-protected-change` fully green and the sentinel test 11/11.

**Roadmap 24.12 — `AgentSession.send()` modularized (was LIVE, now addressed).** Three
behavior-preserving extractions, all private methods on `AgentSession`:
`maybeCompact(controller, turn)` (reactive-compaction block), `guardianIntercept(prepared,
signal)` (the native guardian gate — returns blocked ids + their error results + the optional
`guardian_blocked` event), and `dispatchToolCalls(...)` (loop-guard warnings/refusals +
session-tool dispatch; returns true on cancellation). `send()` dropped from ~388 to **209
lines**. No behavior change: event order, ledger entries, checkpoint commits, and cancellation
paths are byte-for-byte the same; the guardian/loop/verification tests that pin dispatch
ordering all pass unchanged. Full suite 746 (cli 33 / core 490 / tui 223) green; full gate
green.

---

## 2026-09-20 — CONCURRENT SESSION DETECTED (do not cross-commit)

A second, still-active session is editing the TUI transcript-scroll feature while the audit
below lands. Observed mtimes: `displayLimits.ts` 02:44:04, `transcriptWindow.ts` 02:44:17,
`MessageList.tsx` 02:44:34, `App.tsx` 02:45:22, `transcriptWindow.test.ts` 02:45:35 (adds
`TRANSCRIPT_SCROLL_PAGE` / `applyTranscriptPin`, PgUp/PgDn pin-back). Together with
`transcriptWindow.test.ts` that is five files, NONE touched by the audit session.

Consequence for the next committer: those five files are another session's in-flight work.
Do not `git commit -am` — stage only the audit session's `packages/core` files plus
`CHANGELOG.md` / `PROGRESS.md`. The last full `npm run gate` was green but ran mid-write
(their `App.tsx` landed after it), so a fresh gate is required before any commit that
includes their files.

---

## 2026-09-20 — Chief-engineer audit (this session)

**Agent (this session)** — owns & changed (non-protected; no protected artifact touched,
so no manifest/sentinel change required):
- `packages/core/src/tools/bash.ts` — **read-only safe-list escape closed.** The
  `READ_ONLY_SUBCOMMANDS` branch returned on the subcommand name alone, so
  `git diff --no-index /dev/null <host path>` was auto-allowed with no prompt and dumped
  that host file into the transcript — reproduced end-to-end through `AgentSession` →
  `ToolOrchestrator`, not by reading. The same branch was also a prompt-free write
  primitive via `--output`. Subcommand args now go through the same `pathsInsideRoot`
  containment as the file readers, escape flags are refused by prefix (git abbreviates
  its long options), and a missing `projectRoot` fails closed.
- `packages/core/src/tools/__tests__/bash.test.ts` — new regression test
  "contains subcommand arguments to the project root".
- `CHANGELOG.md`, `PROGRESS.md` — records.

**Evidence:** red/green — the pre-fix `dist/` returned true for both escapes; post-fix a
scripted-provider probe shows `run_command` now prompts for them while `git status`,
`git log --oneline`, `git diff --stat`, and `ls ./src` stay prompt-free. Focused suite 21
tests green; full gate green.

**Then fixed in the same pass (operator approved the narrow option):** the guardian's scan
surface. A `run_command`
never reaches the interceptor at all — the interceptor requires a `path` field on the tool
input, which `run_command` does not have. The `else` branch for MCP/plugin mutations IS
reached, but it scans the `describeToolInput` preview, whose shapes carry no `+` lines, so
`scanDiffForSlop` can never match there. Verified with a discriminating control (auto-fix
is silent, so the proof is the bytes the tool received): the same raw-error text is
repaired before dispatch for `write_file` yet reaches the tool untouched via `run_command`
and via an MCP-style tool carrying a path. The comment at `session.ts:662` claims that
preview is a unified diff, which no registered `describe` implementation returns.

**Resolution:** `session.ts` now scans a mutating external (MCP / plugin) tool's declared
file-body fields (`GUARDIAN_CONTENT_KEYS`) instead of the prose preview, so that branch can
actually match; the false comment is replaced by a precise coverage note. `run_command`
stays unscanned **by decision** — it declares no `path`, and scanning raw command text would
refuse legitimate commands (a grep for a placeholder marker is not slop, and the model
cannot "fix" a legitimate argument). It remains gated by the permission prompt and the
destructive-command refusal, and that limit is now stated in the code rather than implied.
Tests: a mutating external tool whose body carries a violation is refused with its executor
never running; the same tool with a clean body runs. Red evidence: the pre-fix probe
recorded the untouched body reaching the executor. Full gate green after both fixes.

**S4.1 follow-through (same session)** — additionally owns & changed:
- `packages/core/src/tools/__tests__/bash.test.ts` — 58-row verdict table covering every
  safe-listed binary, each row carrying its basis (contained / inert / metadata / gated).
  Every documented verdict matched observed behavior on the first run, including the
  deliberate `metadata` rows (`df /etc`, `which bash`).
- `README.md` §Safety — splits project-contained readers from inert printers and states the
  containment is lexical, not a sandbox. `packages/core/src/tools/bash.ts` header — same
  caveat for the destructive-command filter ("BEST-EFFORT PATTERN MATCHING, NOT A SANDBOX").
- `docs/STABILIZATION-ROADMAP-2026-09.md` — §S4.1's three boxes and the S2/S1 residue doc box
  ticked with dated evidence; a dated update note marks the section's intro paragraph (which
  claims the subcommand alone is trusted) as pre-fix.
- Evidence: `bash.test.ts` 22 tests green; full gate green (0-5) with BOTH sessions' work on
  disk (mine + the concurrent TUI scroll-pin session's five files).

---

## 2026-09-20 — MCP/SSE transport hardening (same session, second slice)

**Agent (this session)** — owns & changed:
- `packages/core/src/mcp/transport.ts` — STABILIZATION §S3.1 + §S3.2 closed. One deadline
  installed BEFORE the GET (the old one was installed only after it resolved, so an
  unanswered GET hung forever); one pump PER ATTEMPT (a shared pump left the retry reading a
  dead stream); every failed-attempt path aborts, untracks, and finishes its pump; pump queue
  capped by lines and bytes; SSE frame tail capped with a terminal `overflowed` flag; response
  bodies read with the cap enforced DURING the read; off-origin `endpoint` refused; redirects
  refused on both GET and POST.
- `packages/core/src/config/constants.ts` — `MCP_MAX_PUMP_QUEUE_LINES` / `MCP_MAX_PUMP_QUEUE_BYTES`
  (env-overridable, per the no-magic-constants rule).
- `packages/core/src/mcp/__tests__/transport.test.ts`, `.../sse.test.ts` — pump/frame/origin
  unit tests plus end-to-end cases (unanswered GET, silent-after-handshake, off-origin
  endpoint, oversized POST response).
- `README.md` §MCP servers, `CHANGELOG.md`, `docs/STABILIZATION-ROADMAP-2026-09.md` (§S3.1 and
  §S3.2 ticked with dated evidence).

**Evidence:** red/green against the PREVIOUS build before changing anything — with
`timeoutMs: 300`, a server that completed the handshake and then stayed silent left **1 stream
open and retained** after the rejection, and a server that never answered the GET was **still
pending after 2003ms**. Focused suites 25 green; full gate green (0-5).

**Note — `PROGRESS.md` is deliberately NOT staged with this slice.** The file is contended: a
concurrent session ("OpenCode session (scroll-first)") writes its own ownership section here,
and commit `0c61ffa` already swept one of their sections in (docs only — none of their code
was committed, every tui file was verified unstaged first). Leaving this file dirty avoids
repeating that; whichever session commits it next lands both records.

---

## 2026-09-20 — PHASE-21-25-AUDIT re-classification (protected artifact)

**Agent (this session)** — owns & changed:
- `docs/PHASE-21-25-AUDIT.md` — **PROTECTED ARTIFACT.** Re-audited every matrix item against
  the live tree by symbol (not line number). Result: all 26 items are now green — every 🔴 LIVE
  item is fixed in live code; **22.13 stays 🟣 BY-DESIGN and must not be changed.** Promoted
  **22.9 / 22.11 / 22.17** from ⚪ UNVERIFIED to ✅ FIXED, each with traced evidence. Left
  **23.4 as 🟡 PARTIAL** (only `MessageView` memoized — not done). Corrected the stale test
  count 556 → **788** (core 519 / tui 228 / cli 41 across 121 files) and marked the
  "gate only scans NEW lines" section **RESOLVED** by Step 1.5 (the doc had contradicted its
  own gate-hardening §6). Motivation: AGENTS.md §1.5 sends every agent here first, and the doc
  was directing them to re-fix already-fixed items — a trap, not just stale prose.
- `scripts/gate-manifest.json` — **PROTECTED ARTIFACT.** SHA-256 for `docs/PHASE-21-25-AUDIT.md`
  regenerated in the same commit (AGENTS.md §3.4b); coverage key set unchanged, `generated`
  bumped to 2026-09-20. No other protected file was touched.
- `CHANGELOG.md` — Under [Unreleased].

**Declaration per AGENTS.md §3.4(a):** this is a protected-artifact change. It touches
`docs/PHASE-21-25-AUDIT.md` (re-classification) and `scripts/gate-manifest.json` (same-commit
manifest regen, §3.4b). The sentinel test asserts the manifest against live content, so it
stays in sync without an edit. `AGENTS.md`, `verify-gate.mjs`, `.fresh-allowlist.json`, the
sentinel test, and `.github/workflows/*` are **unchanged**. Requirement §3.4(c) — explicit
human review of the protected-path diff — is pending the user's review; the gate was run with
`--ack-protected-change` as the local acknowledgement.

**Evidence:** per-item symbol checks recorded in the matrix (e.g. 22.11 `usePermissionBroker`
subscribes in `useEffect`; 22.17 `App.tsx` mount effect prints `mcp.notices`; 24.4 and 24.10
both at 0 production hits across core/tui/cli). Full `npm run gate` green (0–5).

---

## 2026-09-20 — STABILIZATION §S4.2: `edit_file` result cap (F12)

**Agent (this session)** — owns & changed:
- `packages/core/src/tools/editFile.ts` — the source-file stat check bounds only the INPUT;
  `new_str` is model-supplied and unbounded, so a 10 KB file plus a 1 MB replacement was
  diffed and written unchecked. The cap now runs on the RESULT (`Buffer.byteLength(updated)`)
  immediately after `current.replace` and **before** `createTwoFilesPatch`, throwing
  `EditValidationError` — the executor returns its clean `{error, summary}` shape and never
  reaches `atomicWriteText`.
- `packages/core/src/tools/__tests__/editFile.test.ts` — 1 new regression test (`10 KB file +
  1 MB new_str → validation error, file byte-identical`). Now 8 tests.
- `docs/STABILIZATION-ROADMAP-2026-09.md` — §S4.2 both boxes ticked with dated evidence;
  status header refreshed (S3.1–S3.2, S4.1, S4.2 now done; still open: S1.3 rewind
  external-edit warning, S2.3, S5, S6, S7).

**Evidence (red → green):** against the PRE-FIX source the new test failed with
`expected false to be true` (`isError` was `false` — the ~1 MB write went through). After the
fix: `editFile.test.ts` 8/8, plus `writeFile.test.ts` 7/7 for the shared cap constant.

**Not a protected artifact** — no `AGENTS.md`/gate/manifest/allowlist/sentinel/CI path
involved, so no manifest work is required.


## 2026-09-22 — Post-review fixes (Buffy, chief-engineer pass)

**Agent (this session)** — owns & changed (all non-protected; no protected
artifact touched, so no manifest/sentinel change is required):
- `packages/core/src/agent/session.ts` — `guardianIntercept` now reports
  `count: blocked.size` (refused CALLS) instead of `blockedByPath.size`
  (distinct PATHS). The event contract in `agent/types.ts` and both renderers
  (`terminalRenderer.ts`, TUI turn report) say "calls blocked"; two refused
  writes to one file used to report `count=1`.
- `packages/core/src/agent/__tests__/guardianDispatch.test.ts` — +1 regression
  case: two blocked `write_file` calls to the SAME path must report `count=2`.
- `ANALYSIS_REPORT.md` — **removed.** Stale v0.8.0 (2026-09-11) deep dive whose
  "critical" items were already re-verified FIXED in `docs/AUDIT-2026-09-14.md`;
  leaving it at the repo root misleads the next agent (AGENTS.md §1.5).
- `README.md` — release badge v1.0.0 → v1.1.0 (matches `version.ts`); the
  architecture diagram said "Provider Adapters (10)" → 11.
- `docs/STABILIZATION-ROADMAP-2026-09.md` — status header no longer claims S7
  has open boxes; every S7 box is ticked in the body.
- **NEW `packages/core/src/agent/guardianIntercept.ts`** + **NEW
  `packages/core/src/agent/__tests__/guardianIntercept.test.ts`** — extracted the
  session's 104-line `guardianIntercept` method into `guardianInterceptCalls`.
  The guardian library stays pure (no agent/TUI types): the module lives in the
  AGENT layer, shapes the `guardian_blocked` event and refusal results, and
  RETURNS the repair prompt instead of pushing it (the session owns history).
  Behavior-preserving: same scan surface, same positional auto-fix, same
  `loop_refused` ledger entry, same event shape/order. `agent/session.ts` drops
  ~100 lines and `guardianIntercept` is no longer `async` (it never awaited).
  Tests: 6 new unit cases (disabled passthrough, block + refusal result + ledger
  + prompt, non-mutating/no-path ignored, external-tool body scan, positional
  same-path auto-fix, universal-vs-anvil scope) plus the existing 12 dispatch/
  toggle integration tests, all green. Evidence: core typecheck 0; core suite
  **659/659** (88 files); full `npm run gate` green (0–5, 15/15 mock evals).

- `packages/core/src/agent/orchestrator.ts` + `__tests__/orchestrator.test.ts` —
  the review flagged the `__parseError` check appearing in BOTH `executeTool`
  and the orchestrator. Investigation showed the orchestrator's copy is NOT
  redundant: it runs before the mutating/permission branch, so a malformed
  mutating call is reported as malformed instead of prompting the user for a
  mutation that cannot be described. Kept it, documented WHY inline, and pinned
  it with a regression test (malformed mutating call → `tool_finished` error,
  broker never invoked, ledger `error`). Orchestrator tests 8 → 9.

- `packages/core/src/config/index.ts` + `__tests__/config.test.ts` —
  `hasAnyConfiguredProvider` now inspects the real provider key fields
  (derived from `PROVIDER_ORDER`) instead of "any non-empty string value". The
  old shape worked only because every `ProviderCredentials` field happens to be
  a key; a future non-secret field would have reported a configured install and
  skipped first-run onboarding. +2 tests (empty, keyless, non-secret).

**Bug hunt (no defect found, recorded):** reviewed `providers/freeModels.ts`
(circuit breaker / consecutive-429 backoff / `pruneHealthForModels` key parsing)
and the full `mcp/transport.ts` (pump retention caps, line splitter overflow,
SSE frame parser CRLF holding, one-deadline connect, off-origin endpoint refusal,
bounded response reads, redirect: error on both verbs). Both are clean — the S3
hardening landed as described. No change made rather than manufacture one.

- **NEW `packages/cli/src/args.ts`** + **NEW `__tests__/args.test.ts`** — moved
  `parseFlags` out of the interactive entry (`index.tsx`) so the argument
  contract is testable without Ink or a child process. Behavior unchanged
  (same exits, same messages); `index.tsx` now imports it. 9 tests: both
  spellings of prompt/goal, --provider/--model values, boolean switches, bare
  words ignored, single-dash value accepted, missing value and unknown flag
  both exit 1 with the right stderr, and a doubled dash reads as the next flag.
  This is the recorded S7 gap ("index.tsx at 0%") attacked the only safe way:
  real logic out of the entry point rather than an Ink harness around it.
  Measured: `packages/cli` statements **44.02% → 49.14%** (258/525).
  `index.tsx` itself remains untested — it is now smaller, and what remains
  there is genuinely process/Ink wiring that needs a harness to cover.

- `packages/cli/src/args.ts` + `__tests__/args.test.ts` — added
  `resolveInvocation(argv, { hasConfiguredProvider })`, the whole dispatch
  decision as a pure union (`version|help|setup|gate|health|init|
  init-usage-error|run`). `index.tsx`'s top-level is now a thin switch over it,
  and the default path moved into a named `runFromFlags()` instead of an inline
  IIFE. +8 tests pin the mode matrix, including "--version beats every
  subcommand" and "--help is honored anywhere".
- `packages/core/src/agent/session.ts` — extracted `send()`'s tool-batch
  settlement (snapshot → orchestrator → abort/partial checkpoint commit →
  mutation accounting → history push) into `settleToolBatch`, returning
  whether the batch was cancelled. Behavior-preserving; `send()` is now ~175
  lines (was ~195), and the checkpoint/history bookkeeping has one home.
  `takeRewindSnapshot`/`commitRewindSnapshot` now take readonly views.

**Finding 6 (AgentSession DI) — disposition, stated rather than skipped:** the
remedy applied is progressive EXTRACTION plus direct unit tests of the extracted
units (`turnStream`, `turnVerifier.finishTurn`, `guardianInterceptCalls`,
`ToolOrchestrator`, `SessionLedger`, `RewindRing`, `settleToolBatch`) — the
repo's established idiom. Constructor DI of injected collaborators was
deliberately NOT added: it would create optional production options with no
production caller, which AGENTS.md §2.8 forbids, for no behavioral gain.

**Audit pass 2 (unread modules) — findings and fixes:**
- `packages/core/src/git/gitUtils.ts` — **REAL BUG fixed.** `getBranchDiff`
  passes the branch as a rev-arg; the comment claimed the trailing `--` stops a
  `-`-prefixed branch from being read as a flag, but `--` only ends PATH parsing,
  so `git diff --output=<file>...HEAD --` made git WRITE a file instead of
  printing the diff. Branch is now validated (empty / leading `-` refused) and
  the comment corrected. Reached from `/diff <branch>`
  (`tui/src/commands/handlers/diff.ts`) with user-typed input. +1 test.
- `packages/core/src/lsp/client.ts` — **crash path closed.** The child's stdin
  had no `error` listener, so an async EPIPE after the server died surfaced as
  an uncaught stream error instead of failing the client — `mcp/transport.ts`
  already guards its pipe this way. +1 assertion in the existing crash test.
- `packages/core/src/plugins/registry.ts` — **documented limitation.** The
  plugin `{input}` JSON is MODEL-controlled and shell-spliced into `bash -c`,
  so an unquoted placeholder exposes shell metacharacters. It is the plugin
  author's explicit shell extension point and every plugin tool is gated by the
  permission prompt, so this pass documents the risk and the durable fix
  (pass the JSON as an argv element) rather than redesigning the plugin
  contract — the prompt also cannot render the command (the describe seam has no
  tool name). Recorded, not silently accepted.
- **NEW `packages/cli/src/__tests__/entry.test.ts`** — entry-point harness:
  sets argv, stubs `process.exit`/`console`, imports `index.tsx` fresh. Covers
  the two branches that terminate before rendering (`--version`, `init` usage
  error). Vitest isolates each file's process env, so the handlers index.tsx
  registers cannot leak into other suites.
- **NEW `packages/cli/src/__tests__/docTruth.test.ts`** — doc-truth guard (5
  tests): every asserted value is DERIVED FROM CODE (badge == `CORE_VERSION`,
  provider count == `createProviders()` keys, tool count == `TOOL_DEFINITIONS`,
  Node badge == `engines.node`, roadmap header == its own checkbox count), so it
  can only fail on drift, never on its own staleness. RED-proven by
  re-badging the README to v1.0.0.

**Reviewed clean (no defect):** `tools/verifyTests.ts` (argv-not-shell pattern
filtering, clamped timeouts, scrubbed env), `plugins/loader.ts` (manifest
validation/bounds), `config/mcp.ts` (SSE url/origin/header validation).

**Evidence (this session):** core typecheck 0; cli typecheck 0; **663** core /
**233** tui / **75** cli tests green; `packages/cli` statements **49.14% →
55.05%** (294/534). Full `npm run gate` green (Steps 0–5, 15/15 mock evals). No
protected artifact touched — no manifest/sentinel change required.
