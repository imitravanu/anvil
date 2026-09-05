# Changelog

All notable changes to Anvil are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/); versions follow semver
(major.minor.patch — breaking features bump minor while pre-1.0).

## [Unreleased] — 0.3.0 scope

### Planned

- Live sub-agent progress while delegation runs (currently only the final report card)
- MCP: newly connected tools enter the running session without a restart
- Persistent checkpoints (`/rewind` currently forgets snapshots on app exit)
- Context gauge in the status bar (`ctx 34%`) from real per-turn token counts
- Automatic rate-limit recovery: wait out the retry window with a visible
  countdown and retry the turn once, instead of surfacing the error

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

[Unreleased]: https://github.com/mitravanu/anvil/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/mitravanu/anvil/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/mitravanu/anvil/releases/tag/v0.1.0
