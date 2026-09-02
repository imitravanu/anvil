# Anvil

A professional-grade, terminal-based AI coding agent — comparable to OpenCode, Codex CLI, and
Cline — with a polished Ink (React) terminal UI. Talk to a model, let it read, write, edit, and
search your project, run shell commands, and watch every mutation through an interactive
permission prompt with a real unified diff.

## Features

- **Four providers, one interface**: Anthropic, OpenAI, Google Gemini, and OpenRouter, with
  streaming responses and a model registry (`/model` picker to switch mid-conversation)
- **Agent loop with 6 tools**: `read_file`, `write_file`, `edit_file` (unified diffs),
  `list_files`, `grep`, `run_command` — with cancellation and path containment to the project root
- **Interactive permissions**: every mutating tool call shows the diff or command before it runs
  (Allow once / Always allow this session / Deny)
- **Session persistence**: conversations auto-save to `~/.anvil/sessions/` and can be listed,
  resumed, and renamed (`/session`)
- **Context compaction**: when usage nears the model's context window, older history is
  summarized automatically so long sessions keep working
- **Theming**: `/theme dark | light | highContrast`, persisted in settings

## Install

```bash
# from a checkout of this repo
cd packages/cli && npm pack
npm install -g ./anvil-cli-0.1.0.tgz

# then run it from any directory
cd ~/my-project && anvil
```

The packages are prepared for npm publishing; inspect `npm pack --dry-run` before a release.

## First-run setup

The first time you run `anvil` (or any time via `anvil config`), you'll be asked to pick a
provider and paste an API key — it's saved to `~/.anvil/credentials.json` (mode 0600) and you
drop straight into a chat, no restart needed.

## Usage

```
anvil                  # start chatting
anvil config           # add or update a provider API key
anvil --version        # print version
anvil --help           # full help

anvil --provider gemini --model gemini-3.6-flash   # one-run overrides
ANVIL_PROVIDER=anthropic ANVIL_MODEL=claude-sonnet-5 anvil
```

Selection precedence: CLI flag → env var → `~/.anvil/settings.json` → first configured provider.
An explicitly selected provider that has no configured API key fails with an actionable error;
it never silently falls back to another provider.

### Slash commands

| Command | Effect |
|---|---|
| `/help` | list commands |
| `/clear` | start a fresh transcript; the prior saved session remains resumable |
| `/model` | open the model/provider picker (cross-provider switches clear history) |
| `/theme <name>` | switch theme (`dark`, `light`, `highContrast`); persisted |
| `/session list` | list saved sessions |
| `/session new` | start a fresh session |
| `/session resume [id]` | resume a session (no id → interactive picker) |
| `/session rename <title>` | rename the current session |

Keys: **Esc** or **Ctrl+C** cancels a streaming turn; **Ctrl+C** while idle exits; **Up/Down** in
an empty input recalls messages you sent this session.

## Safety notes

- All file tools are contained to the directory Anvil was started in, including symlink-aware
  checks on the deepest existing path component.
- Reads and writes are capped at 512 KiB. Shell-command output is capped at about 20 KiB per
  stream and commands are terminated after two minutes.
- "Always allow" permission grants are in-memory, per session — never persisted, never restored
  on `/session resume`.
- Compaction is reactive (based on the previous turn's token usage); a single enormous message
  can still exceed the context window in one hop.

## How this was built

Anvil was built phase-by-phase against a written spec; each phase has a doc with goals, exact
file lists, interfaces, and acceptance criteria:

- `Phase 0` — monorepo scaffold (`docs/`, spec `01-PHASE-0-foundation.md`)
- `Phase 1` — provider abstraction layer (spec `02-…`)
- `Phase 2` — agent loop & tool system (spec `03-…`)
- `Phase 3` — TUI shell (spec `04-…`, notes `docs/PHASE-3-NOTES.md`)
- `Phase 4` — permissions, slash commands, model picker (spec `05-…`, notes `docs/PHASE-4-NOTES.md`)
- `Phase 5` — session persistence & context compaction (spec `06-…`, notes `docs/PHASE-5-NOTES.md`)
- `Phase 6` — polish & distribution (spec `07-…`)

## Development

```bash
npm install
npm run build      # build core → tui → cli (cli bundles to a self-contained dist via esbuild)
npm run typecheck  # strict TS across all packages
npm test           # vitest suite (core)
npm run dev        # run the CLI from source
```
