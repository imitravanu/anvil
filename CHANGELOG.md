# Changelog

All notable changes to Anvil are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/); versions follow semver
(major.minor.patch — breaking features bump minor while pre-1.0).

## [0.7.0] — 2026-09-09

### Added

- **Phase 0 Visual Regression Matrix Gate**: Full cross-size (80×24, 120×40, 200×60) ×
  cross-theme (dark, highContrast) deterministic visual baseline suite with pixel-level diffing
  via `pixelmatch` (strict 0.1% threshold) across 8 core UI scenarios (48 baselines total).
- New npm workflow scripts: `visual:capture`, `visual:diff`, and `visual:approve`.
- Automated GitHub Actions CI workflow (`.github/workflows/visual-regression.yml`) to gate PRs
  against visual regressions and upload diff artifacts on failure.
- Second CI workflow (`.github/workflows/ci.yml`) running the full monorepo build, strict
  typecheck, and the complete unit test suite on every push/PR — the 290+ unit tests were
  previously unguarded in CI (only the visual matrix was gated).
- `core/scripts/verify-openrouter.ts`: repeatable live smoke test for the OpenRouter
  adapter (free-model sync, streaming completion, tool-call round-trip) against the real
  gateway; key read from `OPENROUTER_API_KEY` or `~/.anvil/credentials.json`, never logged.
- **Orcarouter provider (free-only)**: new OpenAI-compatible adapter for
  `api.orcarouter.ai/v1` alongside OpenRouter. Paid models are auto-hidden by policy:
  the live source reads the public key-less pricing catalog's `is_free_tier` flag
  (`/api/pricing` — the keyed `/v1/models` listing is stale and carries no pricing)
  and drops paid ids before they can reach the registry or picker, and the picker now
  renders only free models (`visibleModels()`), which also declutters OpenRouter's
  paid entries. Free is decided by the flag alone — never `model_ratio: 0` (image
  endpoints ride at zero cost) and never the `-free` suffix (a listing can go stale).
  Both routers auto-sync through the single free-model coordinator (boot, picker,
  and `/sync`), so free-list churn — models going free, paid, or away — updates the
  registry automatically (a retirement demotes to `(Paid)`, never deletes).
  Orcarouter's "No available capacity" (503) errors are treated as retryable
  rate-limit-class failures.
- `core/scripts/verify-orcarouter.ts`: repeatable live smoke test for the Orcarouter
  free tier (key-less public-catalog sync, streaming completion, tool-call round-trip
  against the real gateway, default `z-ai/glm-5.3-flash-free`, overridable via
  `ORCAROUTER_MODEL`); key read from `ORCAROUTER_API_KEY` or
  `~/.anvil/credentials.json`, never logged.
- Expanded model registry with latest frontier models (Claude 3.7 Sonnet, Claude 3.5 Sonnet/Haiku,
  GPT-4o, GPT-4o mini, o3-mini, Gemini 2.0 Flash, Gemini 1.5 Pro/Flash).

### Fixed & Hardened

- **Bounded `read_file`**: reads no longer materialize the whole file before applying the 512 KB
  context cap. Reads are now `open` → `fstat` → bounded read on the same open file handle (the
  pattern already used by checkpoints), removing both a TOCTOU between the size check and the
  read and the unbounded memory spike on huge files. `totalBytes` still reports the true file
  size, so truncation honesty is unchanged and now pinned by a dedicated test.
- **`run_command` preview guard**: the permission-prompt `describe()` path no longer throws when
  handed a malformed input object; it reports `"(malformed input)"` instead.
- **Tunable tool timeouts**: `ANVIL_RUN_COMMAND_TIMEOUT_MS` and `ANVIL_RUN_TEST_TIMEOUT_MS`
  override the built-in command/test timeouts (120 s / 60 s), sanitized and clamped to
  [1 s, 10 min] so a hostile or typo'd value can neither busy-freeze a turn nor park it for an
  hour. Defaults are unchanged, and the "Timed out after … ms" summary reports the resolved value.
- **Compaction fallback without `usage` events**: `lastInputTokens` previously only moved when a
  provider emitted a `usage` event, so a provider that never does silently disabled the reactive
  context-compaction check while history grew. A per-request `sawUsage` flag now falls back to
  `estimateTokens()` on the current history snapshot, biasing conservative (compacting a bit
  early beats an unhandled provider context overflow). Providers that do emit `usage` are unaffected.
- **Auto-save error reporting**: Session persist errors now route cleanly into the TUI transcript
  via `printSystemMessage` instead of writing raw text to `stderr`, preventing terminal screen
  corruption and row coordinate desync.
- **`retainOutput` edge cases**: Correctly preserves `undefined` tool output without failing `JSON.parse`
  or labeling un-truncated results as truncated.
- **Tool execution resilience**: Wrapped tool execution across all orchestrator paths in try/catch
  boundaries to gracefully report errors without crashing the session loop.
- **Context compaction boundary protection**: Added `findCleanCompactionCut()` to avoid splitting
  tool call/result pairs during compaction, preventing provider history rejection.
- **History integrity repair**: Added `HistoryStore.repairUnclosedToolCalls()` to synthesize error
  results for orphaned tool calls after unexpected turn errors, preserving strict role alternation.
- **Session mutation concurrency guards**: Prevented concurrent execution of `switchModel`,
  `popLastUserTurn`, and `clearHistory` while an active turn is in flight.
- **Safe atomic writes**: Added `atomicWriteText()` with `AbortSignal` support across file write and
  edit operations.
- **Sub-agent and input hardening**: Sub-agents inherit project rules in system prompts; multiline
  paste in `InputBar` flattens newlines to spaces; headless mode stdin timeout (30s) and cap (1 MB).
- Fixed unmounted component instances across TUI test suites to eliminate listener leaks.

## [0.6.3] — 2026-09-08

### Fixed

- **`grep` could freeze the whole app irrecoverably** on a catastrophic-
  backtracking regex. Patterns come from the model and run synchronously —
  Esc/cancel cannot interrupt them. Verified: `(a|aa)+$` hangs Node for >6s
  on a 38-character line. Two independent bounds now protect the scan:
  a pre-flight shape check rejects the explosive class (unboundedly-repeated
  groups with alternation or variable-length repetition inside — bounded
  repeats and exact `{n}` folds stay allowed) and each line is tested on its
  first 4 KB, with long-line coverage surfaced honestly in the output.
  The bomb pattern now returns an actionable error in ~1 ms; normal patterns
  are unaffected.
- Lockfile workspace entries resynced (they still said 0.1.0 from an earlier
  release while the packages were at 0.6.x).

### Improved

- Previous wave (same day): the phantom "… N earlier messages above"
  indicator, the scrollback row budget, the adaptive cockpit header (no more
  mid-name "…" truncation), and theme-consistent chrome.
- Version bumped to 0.6.3 across core/tui/cli.

- **Phantom scrollback indicator**: the "… N earlier messages above" line
  counted the newest (bottom-anchored) message as hidden whenever it alone was
  taller than the transcript — a single exchange whose answer fit on screen
  still reported "… 2 earlier messages above". The fold math now counts only
  messages fully above the clip; a message the fold cuts through is partially
  visible and never counted as lost.
- **Scrollback row budget** matched to the real layout (reserve 10, not 12) so
  the indicator and Yoga's actual list height agree.
- **Header truncated the model name mid-word** ("Ollama · Qwen 2.5 Coder
  (Local) [FREE] …" at 100 columns). The cockpit header now measures its own
  deterministic left-column width and budgets the model tag to the exact
  remainder — the right side can never squeeze the left column (which made
  Ink wrap "▲ ANVIL" onto a second row) — and prefers a compact
  `provider · model` tag over a mid-name "…" when space is tight (state and
  pricing already live in the StatusBar).
- Uncommitted TUI polish wave folded in: theme-consistent colors across the
  chrome, styled slash-command menu, and sent-message recall entries for
  command-driven sends.

## [0.6.2] — 2026-09-07

### Fixed

- **Chat content vanishing in native terminals** (the second, final root of
  the line-stacking family): the app frame was exactly `rows` tall, and Ink
  wipes the whole terminal (screen + scrollback + home) whenever rendered
  height >= terminal rows — true on every re-render, i.e. every spinner tick
  (326 full-screen wipes observed in one short session at 236x46). tmux
  absorbs those wipes; a native terminal desyncs — user messages vanished,
  redraws landed on wrong rows. The frame is now one row shorter than the
  terminal, so Ink always uses its stable in-place diff path. Verified in a
  raw pty (no tmux) across 20-46 rows x 80-236 columns: zero wipes, all
  content persists; tmux behavior unchanged.

## [0.6.1] — 2026-09-07

A full chief-engineer audit of the post-0.6.0 tree plus a concurrent TUI
hardening pass. The headline: the "lines stack and interfere" corruption is
fixed at its root, and two real security holes in the command safe-list are
closed.

### Fixed

- **Line stacking (root cause 1 — input)**: when keystrokes arrive batched in
  one read (fast typing, paste, tmux/SSH), the text-input component embedded
  the carriage return into the input value instead of submitting — a raw
  control character in a rendered frame line desyncs terminal row accounting,
  and every later redraw lands on the wrong rows. Input is sanitized and an
  embedded return now submits.
- **Line stacking (root cause 2 — display)**: the transcript could render
  assistant text, tool summaries, and verification output containing raw
  control characters (`\r` progress lines, ANSI escape codes, tabs), which
  Ink's row accounting cannot survive — borders broke and lines overwrote
  each other for the rest of the session. All display sinks now sanitize
  (`sanitizeTerminalText`): last `\r` segment kept (progress-bar semantics),
  escapes stripped, tabs expanded. Verified live with a command printing real
  color/progress/bell bytes.
- **Security**: the read-only command safe-list no longer auto-allows file
  readers pointed outside the project (`cat ~/.ssh/id_rsa` used to run
  unprompted); `~`/`$HOME` arguments fail closed. The destructive-command
  guard de-shells quotes and command substitution, so `rm -rf "$HOME"` and
  `echo $(rm -rf ~)` are refused.
- **Provider replay**: loop-guard notes were written before tool results in
  history — a 400 on OpenAI-family providers and an Anthropic contract
  violation exactly when a model started looping. Results now lead.
- **Headless honesty**: `anvil -p` exited 0 when the turn was cut off by the
  step budget (now exit 2); Ctrl+C reaches the graceful-cancel handler;
  unknown flags fail loudly; `--help` works anywhere; `-p "-42 is the answer"`
  is accepted.
- **Goal engine**: cancelling or erroring on the planning turn aborts the
  mission instead of burning the turn budget; the milestone review accepts
  only the prompted `YES —` verdict shape (hedges fail); failed milestones
  are visible in headless output.
- **Race conditions**: a message queued in the gap between turns could start
  a second concurrent send; typing between mission turns collided with mission
  turns and failed innocent milestones. The busy claim now spans the whole
  drain/mission, queues drain afterwards, and the Mission Deck's detail line
  updates live.
- A reply taller than the transcript pushed the user's message off the top
  and the "… N earlier messages" indicator (rendered inside the clipped
  region) was itself the first row eaten — the turn vanished without a trace.
  The indicator now sits outside the clip and is always visible.
- The status bar could be squeezed to zero rows by an overflowing transcript,
  and measured width in code points instead of terminal cells (wrapping
  `tokens … out` onto a second row); the bar is shrink-proof and the token
  segment truncates to fit.
- Markdown rendering: ordered lists lost their numbers; table rows laid out
  side by side on one physical line; code blocks could fill the whole
  transcript (long blocks now window head+tail with an omission line);
  structural blocks render with blank-line separation; lists render with a
  hanging indent and literal `•` bullets parse as markers.
- Every fixed-height UI zone is width/height-capped: permission diffs, the
  diff and rewind modals (windowed), the mission deck, tool/sub-agent/
  verification card one-liners, and the outer frame clips as a backstop.
- `grep` reported `truncated: false` when the cap was hit inside the last
  scanned file; the cap is enforced per match.
- `estimateTokens` (proactive compaction on resume) ignored images — each now
  counts a 2k-token floor.
- Concurrent writers to the same file raced one temp name in
  `atomicWriteJson` (sequenced suffix; orphan temps cleaned up).
- The model registry was keyed by id only — the same id under two providers
  silently overwrote, curated rows included. Provider-qualified lookup, and
  registration replaces only that provider's row.
- A crashed sub-agent reported an empty success — the reason is captured and
  surfaced.
- `anvil -p` could hang forever on an open-but-silent non-TTY stdin (5s idle
  window, stderr note).
- Files named like `..config` were rejected as path escapes; unknown model
  ids never compacted (32k fallback window); a delegation that changed files
  now triggers auto-verify; an emptied checkpoint ring clears its persisted
  file; `/connect` is escapable; the `/expand` notice no longer duplicates;
  the transcript scrollback estimator counts settled assistant messages
  through the real markdown parser.

### Changed

- CLI boot (chat / headless / goal) shares one selection/MCP/credentials
  path; MCP connection problems are surfaced on stderr in headless and goal
  mode instead of being swallowed silently. `EXCLUDED_DIRS` is a single
  source (union set) shared by grep / list_files / get_outline / workspace
  awareness.
- Workspace dependency pins fixed (v0.6.0 shipped with stale pins that broke
  fresh installs).

## [0.6.0] — 2026-09-06

### Added

- **Cockpit TUI**: the header now shows the repository name, git branch (with
  dirty `*`), ecosystem, package manager, detected test script, and rules
  source; the status bar shows test-suite health (`🧪 green`/`fail`/`running`)
  and the checkpoint counter (`⎌ <n>`).
- **Verification & self-repair cards**: when the closed-loop verification runs
  in the transcript, a `VerificationCard` shows the test command, pass/fail
  state, failure trace, and repair attempts (`Repair attempt 1/2`).
- **Mission Deck HUD**: while a goal is active, a docked panel above the input
  bar shows the goal, its milestones (`✓`/`▶`/`○`/`✗`), live detail notes, and
  the turn budget (`Turn N/10`).
- **Interactive modals**: `/diff` opens a syntax-highlighted diff modal with
  file tabs (`Tab`/`h`/`l`) and scrolling; `/rewind` opens a checkpoint
  timeline with instant rollback on `Enter`.
- **Goal mode (`anvil -g, --goal "<objective>"` / `/goal`)**: Anvil introspects
  the workspace (git state, ecosystem, package manager, test scripts, project
  rules), decomposes the objective into verifiable milestones, executes them
  autonomously with closed-loop test verification, reviews its own work per
  milestone, and reports a debrief. Milestones are marked completed only with
  evidence (clean turn + passing verification + self-review); failed
  milestones are reported as such and do not abort the run.
- **Closed-loop TDD auto-verification & self-repair**: after file mutations,
  Anvil runs the project's test suite; on failure the trace is fed back into
  context for up to 2 self-repair attempts before the turn completes.
- **`verify_tests` tool**: run the detected test runner (npm, cargo, pytest,
  go) with an optional pattern filter. Patterns are passed to the runner as
  literal arguments — never through a shell.
- **Headless mode (`anvil -p "..."` / stdin pipe)**: non-interactive turns
  stream assistant text to `stdout` and diagnostics to `stderr` (pipeable).
  `-y/--yes` auto-approves mutating tools; without it they are refused, so
  unattended runs are safe by default.
- **Project rules discovery**: `.anvil/rules`, `AGENTS.md`, or `.cursorrules`
  (precedence-ordered, 16 KB cap) are injected into the system prompt at
  session start.
- **`get_outline` tool**: token-efficient structural outline (functions,
  classes, interfaces, types, enums, headings) for TypeScript, JavaScript,
  Python, Go, Rust, and Markdown files.

### Fixed

- **Security**: `verify_tests` no longer interpolates its `pattern` argument
  into a shell command. A pattern is now a separate argv element for the
  detected runner, so model-supplied filter text cannot execute arbitrary
  shell commands (confirmed exploitable before the fix).
- **`/goal` in the TUI now runs the real goal engine.** It previously only
  sent a chat prompt with a hardcoded, never-updating mission deck; the deck
  now reflects genuinely evidence-gated milestones (clean turn + passing
  verification + self-review), live turn counts, and an honest debrief —
  including `✗` for milestones that fail review.
- **Closed-loop auto-verification is now enabled in normal chat sessions**
  (TUI and headless). It was implemented but never switched on outside goal
  mode. After file mutations, the detected test runner gates the turn; in
  headless mode verification runs are visible on stderr (`🧪 [verify] …`).
- Goal engine honesty: milestones are no longer marked completed
  unconditionally — completion requires a clean turn, passing verification,
  and a YES from the per-milestone adversarial review. The final critique is
  retried when it comes back empty instead of printing a blank verdict.
  Short single-action goals now plan one milestone instead of the generic
  three-phase plan. Goal mode aborts with a clear message when a mutating
  tool is permission-refused instead of burning the remaining turns.
- Verification events are surfaced in headless output (`🧪 [verify] …` on
  stderr) instead of running silently.
- The cockpit header reports the correct branch for a git repo with no
  commits (previously shown as "no-git").
- Auto-verification only triggers when a mutating tool actually succeeded;
  cancelled batches and errored calls no longer count as mutations.
- Circuit-breaker accounting: one rate-limited request counts as exactly one
  failure; other errors (e.g. unknown-model 404s) no longer open the circuit;
  the backoff counter is no longer reset while the circuit is open.
- The "Rate limited — waiting Ns, retrying automatically…" notice is rewritten
  when the automatic retry also fails, so the transcript no longer implies a
  retry is still pending next to the final error.

### Planned

- Live verification against the seven unit-tested-only providers (blocked on
  API keys — only Gemini and OpenRouter credentials exist)

## [0.5.0] — 2026-09-06

### Added

- **Vision input**: `/image <path>` attaches a png/jpeg/webp/gif (max 5 MB) to
  your next message; the attachment shows in the transcript and travels as a
  native image part through every adapter (Anthropic base64 blocks, OpenAI
  data-URL content parts, Gemini `inlineData`). Models flagged non-vision get
  a warning at attach time.
- **`/retry <text>`**: retry with corrected wording — the previous exchange is
  dropped and your revised message is sent instead of the original.

### Fixed

- Gemini image parts use the `@google/genai` camelCase shape (`inlineData`/
  `mimeType`); the wire-format `inline_data` shape was rejected with
  "required oneof field 'data'". Verified live: the payload now passes API
  validation (failures become quota errors, not format errors).

## [0.4.0] — 2026-09-06

### Added

- **Message queueing**: typing while the agent is busy now queues the message
  (visible as "⏳ N queued" above the input) and sends it automatically when
  the turn settles — instead of bouncing with "cancel first". Slash commands
  keep their busy-guards; the queue belongs to the conversation and clears
  with /clear or /session switches.
- **`/retry`**: drops your last exchange (answer, tool calls and results
  included) and re-sends the request fresh — history and transcript unwind
  together.
- **`/diff`**: reviews every file the session touched as unified diffs
  against their pre-change snapshots (write_file/edit_file edits; deletions
  and creations included), capped for display.

## [0.3.0] — 2026-09-06

### Added

- **Context gauge in the status bar**: `ctx 34%` from the provider's real
  per-turn token counts vs the model's window; turns amber as compaction
  territory (75%) approaches. Hidden for models unknown to the registry.
- **Automatic rate-limit recovery**: a 429 mid-turn waits out the provider's
  retry window (parsed from the message, clamped 1–120s) and retries the
  request once automatically — a notice appears in the transcript, Esc still
  cancels during the wait, and a second 429 surfaces as a normal error.
- **Live sub-agent progress**: delegation cards now show what the sub-agent
  is doing as it happens ("running… read_file (2 calls so far)") instead of
  freezing until the final report.
- **Persistent checkpoints**: `/rewind` history survives app restarts
  (stored per-session under `ANVIL_HOME/checkpoints/`, mode 0600, ring-capped).

### Changed

- `/mcp reconnect` hot-loads newly connected tools into the running session —
  no restart needed. Sub-agents inherit them too; only mid-turn reloads are
  refused (the in-flight batch classified against the old list).

### Deferred to 0.4.0

- Message queueing while a turn is busy; re-run/edit last message
- `/diff` session review (all file changes made this conversation)
- Image/vision input for vision-capable models
- Live verification against the seven unit-tested-only providers

## [0.2.0] — 2026-09-06

The correctness-and-UX release: a full engineering audit plus a hands-on
pass running real models (Gemini, OpenRouter) through every screen.

### Fixed

- **Frame collapse** — the "lines stack and interfere" bug: with content taller
  than the terminal, Ink compressed every UI zone at once, merging turns onto
  shared rows and breaking overlays. The transcript is now a bounded,
  bottom-anchored scrollback window and only the transcript ever shrinks.
- **Terminal resize** — the frame stayed frozen at boot size when the window
  resized or fullscreened; Anvil now re-renders on the TTY resize event.
- **History corruption on cancel** — cancelling mid-tool-batch (open permission
  prompt, running sub-agent) left tool calls without tool results, which
  providers reject on the next turn. Cancelled batches now close with
  synthetic results.
- **First send after resume** could exceed the model's context window;
  compaction now runs proactively on oversized restored sessions.
- `grep` no longer reads oversized files into memory before skipping them.
- Finished `edit_file` cards show `Edited file (+N −M)` instead of the raw
  diff's separator line.

### Changed

- **Read-only command safe-list**: `ls`, `cat`, `git status`, `node --version`
  and similar plain read-only commands run without a permission prompt.
  Anything with shell metacharacters, globs, or mutating subcommands
  (`git push`, `npm run`) still prompts; auto-allows are recorded in the ledger.
- **`/theme` opens an interactive picker** with live preview (arrow to preview,
  Enter applies and persists, Esc restores the prior theme). `/theme <name>`
  still works directly.
- **Model picker type-to-filter**, plus `[FREE]`-tag dedupe on live-synced names.
- **Friendly provider errors**: rate limits (with retry time), auth failures,
  404s, and context overflow render as one actionable line instead of raw
  provider dumps.
- Typing during a busy turn now prints a notice instead of silently dropping
  input; the transcript shows a "… N earlier messages above" indicator when
  scrolled content is clipped; `/session` and `/rewind` lists use short ids and
  relative timestamps; Esc denies the permission prompt.
- Comments trimmed to load-bearing rationale; internal milestone tags removed.

### Added

- `list_files` accepts plain names (`calc` finds `calc.py`) in addition to globs.
- Regression suites for cancellation history repair and proactive compaction;
  tmux-based visual capture harness (`packages/tui/scripts/capture-frames.sh`).

## [0.1.0] — 2026-09-02

Initial release: nine providers with streaming and a model registry, agent
loop with six tools and path containment, interactive permission prompts with
unified diffs, session persistence, context compaction, theming, first-run
onboarding, sub-agent delegation, and MCP (stdio) support.

## [Unreleased]

### Planned

- Verification/eval harness, provider certification, project memory & git-native workflow, distribution (see `docs/ROADMAP.md`).

[Unreleased]: https://github.com/mitravanu/anvil/compare/v0.7.0...HEAD
[0.7.0]: https://github.com/mitravanu/anvil/compare/v0.6.3...v0.7.0
[0.6.3]: https://github.com/mitravanu/anvil/compare/v0.6.2...v0.6.3
[0.6.2]: https://github.com/mitravanu/anvil/compare/v0.6.1...v0.6.2
[0.6.1]: https://github.com/mitravanu/anvil/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/mitravanu/anvil/compare/v0.5.1...v0.6.0
[0.5.0]: https://github.com/mitravanu/anvil/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/mitravanu/anvil/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/mitravanu/anvil/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/mitravanu/anvil/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/mitravanu/anvil/releases/tag/v0.1.0

