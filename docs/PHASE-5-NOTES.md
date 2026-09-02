# Phase 5 Notes

## Session persistence

- Sessions are saved as flat JSON files under `~/.anvil/sessions/<id>.json`
  (human-inspectable, no database). A corrupt/partial file is skipped by
  `listSessions()`, never thrown.
- **Auto-save**: every turn (completed, cancelled, or errored) is persisted
  immediately — `saveSession()` runs after the agent loop settles, plus after
  `/clear`. There is no explicit save command; the on-disk file always reflects
  the last finished turn.
- `/session list | new | resume [id] | rename <title>`; bare `/session resume`
  opens the `SessionPicker` overlay (Enter resumes, Esc cancels). Resuming
  replays the stored text messages into the transcript; tool-call/result parts
  are kept in history for the model but not redrawn.
- Session default title = first user message truncated to ~50 chars;
  renameable via `/session rename <title>`.

## Context compaction

- **Threshold**: when the previous turn's reported `inputTokens` reach 75% of
  the active model's `contextWindow` (looked up from `MODEL_REGISTRY`), the
  next turn first summarizes everything except the most recent 6 messages
  (`KEEP_RECENT_MESSAGES`) into a single `[Earlier conversation summary]`
  user message, then proceeds. The user sees a "Conversation compacted"
  system message with the summary.
- **Reactive, not predictive (known limitation)**: compaction uses the
  *previous* turn's token count to decide *before* the next turn. A single
  enormous message can still jump straight past the threshold in one turn and
  hit a real max-context error. A proper token-counting approach is a future
  improvement, not a Phase 5 requirement.
- Above the threshold but with ≤ `KEEP_RECENT_MESSAGES` messages of history,
  compaction does nothing rather than summarizing everything away.

## Permission scoping across sessions

Phase 4's "Always allow `<tool>` this session" choices are **session-scoped,
in-memory only** and are NOT part of `StoredSession`. Resuming a saved session
does **not** restore previously-granted "always allow" choices — you will be
prompted again. That is intentional, not a bug: persistence of permission
grants would be a security regression.
