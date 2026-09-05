# Anvil

A professional-grade, terminal-based AI coding agent — comparable to OpenCode, Codex CLI, and
Cline — with a polished Ink (React) terminal UI. Talk to a model, let it read, write, edit, and
search your project, run shell commands, and watch every mutation through an interactive
permission prompt with a real unified diff.

## Features

- **Nine providers, one interface**: Anthropic, OpenAI, Google Gemini, OpenRouter, Groq,
  GitHub Models, Cerebras, Mistral AI, and local Ollama — streaming responses, a model
  registry (`/model` picker to switch mid-conversation), and automatic OpenRouter free-model
  syncing
- **Free & local models**: keep API spend at $0 with Groq's free tier, GitHub Models, Cerebras,
  Mistral's experimentation tier, or Ollama (fully offline). Every model is tagged `[FREE]` or
  `[PAID]` in the picker and header, so pricing is always visible.
- **Agent loop with 6 tools**: `read_file`, `write_file`, `edit_file` (unified diffs),
  `list_files`, `grep`, `run_command` — with cancellation and path containment to the project root
- **Interactive permissions**: every mutating tool call shows the diff or command before it runs
  (Allow once / Always allow this session / Deny)
- **Session persistence**: conversations auto-save to `~/.anvil/sessions/` and can be listed,
  resumed, and renamed (`/session`)
- **Context compaction**: when usage nears the model's context window, older history is
  summarized automatically so long sessions keep working
- **Theming**: `/theme dark | light | highContrast` (or your own names from `~/.anvil/themes.json`), persisted in settings

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

You can re-run this onboarding flow any time **from inside the app** with `/connect` — pick
a provider, paste (or replace) its API key, and Anvil registers it live. If you connect the
provider you're already chatting with, the active session hot-swaps onto the new key
(history is preserved, no restart). If it's a different provider, Anvil offers `/model` to
switch to it.

Picking **Ollama** needs no API key at all — it connects to `http://localhost:11434` and
stores a placeholder so the config layer is satisfied. Free-tier providers (Gemini, Groq,
GitHub Models, Cerebras, Mistral, OpenRouter's `:free` routes) are marked `[FREE]` in the
model picker and header.

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

Type `/` and a **command menu appears automatically** — arrow through it, Enter to run, Tab to
fill. Or type the command directly:

| Command | Effect |
|---|---|
| `/help` | list commands |
| `/clear` | start a fresh transcript; the prior saved session remains resumable |
| `/connect` | add or update a provider API key right inside the app (no restart) |
| `/expand` | toggle full tool output in the transcript |
| `/ledger` | show this session's run ledger (what ran, what failed, tokens spent) |
| `/rewind` | list file checkpoints, or restore one (`/rewind <n>`); shell commands can't be rewound |
| `/sync` | sync OpenRouter's live free-model list now (also runs automatically at startup) |
| `/model` | open the model/provider picker (cross-provider switches clear history) |
| `/theme <name>` | switch theme (built-in or custom); persisted |
| `/session list` | list saved sessions |
| `/session new` | start a fresh session |
| `/session resume [id]` | resume a session (no id → interactive picker) |
| `/session rename <title>` | rename the current session |
| `/mcp` | MCP server status (tools, health) |
| `/mcp reconnect` | reconnect + refresh all MCP servers (new tools need a restart to enter the session) |

Keys: **Esc** or **Ctrl+C** cancels a streaming turn; **Ctrl+C** while idle exits; **Up/Down** in
an empty input recalls messages you sent this session; typing **/** opens the command menu.

## Safety notes

- All file tools are contained to the directory Anvil was started in, including symlink-aware
  checks on the deepest existing path component.
- Reads and writes are capped at 512 KiB. Shell-command output is capped at about 20 KiB per
  stream and commands are terminated after two minutes.
- Commands that would destroy the filesystem outside the project (`rm -rf /`, `rm -rf ~`,
  fork bombs, `mkfs`, raw `/dev` writes, recursive `chmod /`) are refused without executing —
  defense in depth behind the permission prompt. Project-local `rm -rf ./build` still runs
  (with permission).
- File writes snapshot automatically before they run (last 5 turns, memory-only);
  `/rewind <n>` restores one. Shell commands can't be rewound.
- Set `ANVIL_HOME` to relocate Anvil's data dir (credentials, settings, sessions, model cache);
  it defaults to `~/.anvil`.
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
- `Phase 7` — free & local model providers + OpenRouter live free-model sync
  (notes `docs/PHASE-7-NOTES.md`)
- `Phase 8` — truthful engine + free-model radar (spec `docs/PHASE-8-SPEC.md`,
  progress `docs/PHASE-8-PROGRESS.md`)
- `Phase 9` — sub-agent delegation (spec `docs/PHASE-9-SPEC.md`,
  progress `docs/PHASE-9-PROGRESS.md`)
- `Phase 10` — MCP external tools, stdio only (spec `docs/PHASE-10-SPEC.md`,
  progress `docs/PHASE-10-PROGRESS.md`)

## MCP servers (Phase 10)

Anvil can call tools from local MCP servers (stdio transport only).
Create `~/.anvil/mcp.json` (or `$ANVIL_HOME/mcp.json`, mode 0600 if you put
secrets in `env`):

```json
{
  "servers": {
    "my-tools": {
      "command": "node",
      "args": ["./mcp-server.js"],
      "env": { "MY_TOKEN": "..." },
      "timeoutMs": 60000
    }
  }
}
```

Server tools appear as `mcp_<server>__<tool>`, gated by the normal permission
prompt (unknown external tools are treated as mutating unless the server
marks them read-only). `/mcp` shows per-server health; `/mcp reconnect`
refreshes connections.

Boundaries, stated plainly:

- **Local stdio only.** Remote (SSE/HTTP) servers are refused with an error.
- **No undo.** MCP and shell actions can't be rewound — only local file
  writes (`/rewind`).
- **Servers see tool arguments.** Anything the model sends a server tool
  (file contents included) is visible to that server process. Install only
  servers you trust, same as any local dev tool.

## Custom themes

Define your own themes in `~/.anvil/themes.json` (or `$ANVIL_HOME/themes.json`):

```json
{
  "midnight": {
    "colors": {
      "primary": "magenta",
      "userText": "white",
      "assistantText": "green",
      "toolName": "yellow",
      "toolRunning": "yellow",
      "toolDone": "green",
      "toolError": "red",
      "dim": "gray",
      "border": "magenta",
      "accent": "#ff00ff",
      "surface": "gray"
    },
    "spacing": { "panelPaddingX": 1, "panelPaddingY": 0 }
  }
}
```

All 12 color keys are required (named chalk colors or hex); `spacing` is
optional. Names must be `[a-z0-9-_]` and must not shadow built-ins. Invalid
entries are reported (never half-loaded) — run `/theme` with no args to see
available names plus any problems. Select with `/theme midnight`.

## Development

```bash
npm install
npm run build      # build core → tui → cli (cli bundles to a self-contained dist via esbuild)
npm run typecheck  # strict TS across all packages
npm test           # vitest suite (core)
npm run dev        # run the CLI from source
```
