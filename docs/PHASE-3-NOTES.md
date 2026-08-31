# Phase 3 Notes — READ BEFORE USE

## ⚠️ Permission prompts are NOT implemented yet

In this phase every **mutating tool call auto-executes without asking**.
`packages/cli` wires the agent to core's `AUTO_APPROVE_BROKER`, so `write_file`,
`edit_file`, and `run_command` run immediately when the model requests them.

This is a deliberate Phase 3 placeholder (it keeps the TUI work isolated from
permission-UI design), but it means **anything the model decides to do to your
project happens for real**. Run Anvil only in directories where that is
acceptable, and prefer the scratch-directory habit until Phase 4 ships the
interactive permission prompts with diff previews.

Path containment is still in force: all file tools are restricted to the
project root Anvil was started in (`process.cwd()`).

## What exists in this phase
- Chat layout: header, message list, input bar, status bar
- Streaming assistant text (plain while streaming, fenced code blocks
  syntax-highlighted once the turn settles)
- Tool-call activity indicators (running / done / error)
- Esc cancels the in-flight turn
- Provider/model chosen via `ANVIL_PROVIDER` / `ANVIL_MODEL` env vars
  (default: `gemini` / `gemini-3.6-flash`) — the interactive picker is Phase 4

## Known limitations
- No slash commands, no model picker, no session persistence (later phases)
- Message history is per-process; exiting loses the conversation
