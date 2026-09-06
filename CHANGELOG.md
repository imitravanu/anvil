# Changelog

All notable changes to Anvil are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/); versions follow semver
(major.minor.patch — breaking features bump minor while pre-1.0).

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

[Unreleased]: https://github.com/mitravanu/anvil/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/mitravanu/anvil/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/mitravanu/anvil/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/mitravanu/anvil/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/mitravanu/anvil/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/mitravanu/anvil/releases/tag/v0.1.0

## [Unreleased]

### Fixed

- `grep` reported `truncated: false` when the result cap was hit inside the
  last scanned file; the cap is now enforced per match.
- `estimateTokens` (proactive compaction on resume) ignored image parts — an
  image-heavy resumed session under-seeded and died on the provider's context
  limit. Each image now counts a fixed 2k-token floor.
- Concurrent writers to the same file shared one temp name (pid suffix only)
  and could race each other's rename in `atomicWriteJson`; a failed write also
  left the orphan temp behind.
- The model registry was keyed by id only, so the same id under two providers
  silently overwrote (last-wins) — including live-synced rows overwriting
  curated ones. Lookups are provider-qualified first, and cross-provider
  registration replaces only that provider's row.
- A crashed sub-agent reported an empty success — the failure reason is now
  captured (`failureReason`) and surfaced in the delegation result and card.
- `anvil -p` could hang forever on an open-but-silent non-TTY stdin; after a
  5s idle window it proceeds without piped input (stderr note).
- The transcript could render assistant text, tool summaries, and verification
  output containing raw control characters (`\r` progress lines, ANSI escape
  codes, tabs). Ink's row accounting cannot survive those — borders broke and
  lines overwrote each other for the rest of the session. All display sinks
  now sanitize (`sanitizeTerminalText`): last `\r` segment kept (progress-bar
  semantics), escapes stripped, tabs expanded.
- A reply taller than the transcript pushed the user's message off the top and
  the "… N earlier messages" indicator (rendered inside the clipped region)
  was itself the first row eaten — the turn vanished without a trace. The
  indicator now sits outside the clip and is always visible.
- The status bar had no `flexShrink: 0`, so an overflowing transcript could
  squeeze its single row to zero and the bar disappeared entirely.
- The status bar measured its width in code points instead of terminal cells
  and ignored the frame border, wrapping `tokens … out` onto a second row with
  long model names; it now truncates the token segment to fit.
- Markdown rendering: ordered lists lost their numbers (`1.` → `•`); table
  rows laid out side by side on one physical line (row Box default
  direction); code blocks had no containment and could fill the whole
  transcript (long blocks now window head+tail with an omission line);
  structural blocks render with blank-line separation and a box-drawing table
  rule.
- The transcript scrollback estimator now counts settled assistant messages
  through the real markdown parser (windowed code, tables, spacing) so the
  hidden-messages indicator stays honest.
- Markdown lists render with a hanging indent: wrapped continuation lines
  align under the item text instead of column 0, and literal `•` bullets
  (which models emit instead of markdown dashes) parse as list markers.

### Changed

- CLI boot (chat / headless / goal) no longer repeats three near-identical
  ~60-line blocks; MCP connection problems are surfaced on stderr in headless
  and goal mode instead of being swallowed silently. `EXCLUDED_DIRS` is a
  single source (union set) shared by grep / list_files / get_outline /
  workspace awareness.

### Planned

- Verification/eval harness, provider certification, project memory & git-native workflow, distribution (see `docs/ROADMAP.md`).
