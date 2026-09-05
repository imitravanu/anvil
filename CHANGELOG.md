# Changelog

All notable changes to Anvil are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/); versions follow semver
(major.minor.patch — breaking features bump minor while pre-1.0).

## [Unreleased]

### Fixed

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
