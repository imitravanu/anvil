# Phase 4 Notes

## Permission prompts are now interactive

`AUTO_APPROVE_BROKER` is retired. Every mutating tool call (`write_file`,
`edit_file`, `run_command`) shows a `PermissionPrompt` overlay **before** it
runs, with a colorized unified diff for file edits or the literal command text
for `run_command`. Options: **Allow once**, **Always allow `<tool>` this
session** (per tool name, process-scoped, never persisted), or **Deny** (the
model is explicitly told the action was not performed).

## What exists in this phase
- Interactive permission prompt with diff/command previews; overlays take over
  keyboard input — nothing leaks into `InputBar` underneath
- Slash commands: `/help`, `/clear` (clears model history AND transcript),
  `/model`. Unknown commands show a system message and are not sent to the model
- Model/provider picker: unconfigured providers shown dimmed and skipped;
  cross-provider switch clears history (vendor-opaque `providerMetadata` like
  Gemini's `thoughtSignature` must never be replayed through another adapter),
  same-provider switch preserves it — a system message explains the clearing
- `AgentSession.switchModel()` / `clearHistory()` in core, unit-tested for both
  branches

## Known limitations
- "Always allow" is session-scoped only; a restart forgets it (intentional)
- `/compact`, `/session` and persistence belong to Phase 5
- No symlink-aware path containment yet (unchanged from Phase 3)
