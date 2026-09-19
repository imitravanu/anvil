# Anvil

[![CI — Typecheck & Tests](https://github.com/imitravanu/anvil/actions/workflows/ci.yml/badge.svg)](https://github.com/imitravanu/anvil/actions/workflows/ci.yml)
[![Visual Regression Gate](https://github.com/imitravanu/anvil/actions/workflows/visual-regression.yml/badge.svg)](https://github.com/imitravanu/anvil/actions/workflows/visual-regression.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A professional-grade, terminal-based AI coding agent — comparable to OpenCode, Codex CLI, and
Cline — with a polished Ink (React) terminal UI. Talk to a model, let it read, write, edit, and
search your project, run shell commands, and watch every mutation through an interactive
permission prompt with a real unified diff.

## Features

- **Ten providers, one interface**: Anthropic, OpenAI, Google Gemini, OpenRouter, Orcarouter, Groq,
  GitHub Models, Cerebras, Mistral AI, and local Ollama — streaming responses, a model
  registry (`/model` picker to switch mid-conversation), and automatic OpenRouter/Orcarouter free-model
  syncing
- **Free & local models**: keep API spend at $0 with Groq's free tier, GitHub Models, Cerebras,
  Mistral's experimentation tier, or Ollama (fully offline). Every model is tagged `[FREE]` or
  `[PAID]` in the picker and header, so pricing is always visible.
- **Agent loop with 15 tools**: `read_file`, `write_file`, `edit_file` (unified diffs),
  `list_files` (glob or plain-name search), `grep`, `run_command`, `get_outline`
  (token-efficient structure outline), `verify_tests` (run the project's detected test runner),
  `update_plan` (plan scratchpad), `delegate_task` (sub-agent), `update_memory` (project notes),
  plus four LSP-backed code-intelligence tools — `goto_definition`, `find_references`,
  `get_hover`, `get_diagnostics` (LSP where a server is installed, honest fallback otherwise) —
  with cancellation and path containment to the project root
- **Interactive permissions**: every mutating tool call shows the diff or command before it runs
  (Allow once / Always allow this session / Deny — or just press **Esc** to deny). Known
  read-only commands (`ls`, `cat`, `git status`, `node --version`, …) run without prompting;
  anything with shell metacharacters, globs, or mutating subcommands always prompts.
- **Model picker with type-to-filter**: 49 built-in models plus live-synced OpenRouter/Orcarouter free
  models — searchable by name; free models sort first. The picker lists free-tier models; paid models stay available via `--model`, env, and settings.
- **Honest UI everywhere**: real unified diffs in permission prompts, bounded transcript with a
  "… N earlier messages above" scrollback indicator, compact actionable error messages (rate
  limits include the retry time), a per-session run ledger (`/ledger`), and file checkpoints you
  can rewind (`/rewind`).
- **Session persistence**: conversations auto-save to `~/.anvil/sessions/` and can be listed,
  resumed, and renamed (`/session`)
- **Context compaction**: when usage nears the model's context window, older history is
  summarized automatically — proactively on resume (estimated) and reactively between turns —
  so long sessions keep working
- **Theming**: `/theme dark | light | highContrast | midnight | hacker` (or your own names from `~/.anvil/themes.json`), persisted in settings

## What it looks like

```
╭──────────────────────────────────────────────────────────────────────────────────╮
│ ▲ ANVIL                            Ollama · Qwen 2.5 Coder (Local) [FREE] · idle │
│──────────────────────────────────────────────────────────────────────────────────│
│ ❯ you                                                                            │
│ add a multiply function to calc.py                                               │
│                                                                                  │
│ anvil                                                                            │
│ Reading calc.py first.                                                           │
│    ✓ read_file Read calc.py (29 bytes)                                           │
│    ✓ edit_file Edited calc.py (+4 −0)                                            │
│                                                                                  │
│ ℹ Checkpoint #1: 1 file snapshotted — /rewind 1 to undo.                         │
│──────────────────────────────────────────────────────────────────────────────────│
│╭────────────────────────────────────────────────────────────────────────────────╮│
││ ⚠ edit_file wants to edit a file                                              ││
││    1  1 │ def add(a,b):                                                       ││
││ +  3    │                                                                     ││
││ +  4    │ def multiply(a, b):                                                 ││
││ ❯ Allow once                                                                    ││
││   Always allow 'edit_file' this session                                         ││
││   Deny                                                                          ││
││  ↑/↓ to move · Enter to confirm · Esc to deny                                   ││
│╰────────────────────────────────────────────────────────────────────────────────╯│
│ Qwen 2.5 Coder (Local) [FREE] │ ○ idle │ tokens 1,842 in · 96 out │ ctrl+c exit │
╰──────────────────────────────────────────────────────────────────────────────────╯
```

## Install

### Global install via npm
```bash
npm install -g @anvil/cli

# run from any project directory
cd ~/my-project
anvil
```

### Try without installing (npx)
```bash
npx @anvil/cli
```

### Build from source
```bash
git clone https://github.com/imitravanu/anvil.git
cd anvil
npm ci
npm run build
npm run test
```

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
anvil gate [--full]    # native guardian scan of the working-tree diff (--full runs the full npm gate)
anvil init --guarded [--lang <typescript|python|rust|go>]   # provision AGENTS.md + .fresh-allowlist.json gates into a repo
anvil --version        # print version
anvil --help           # full help

anvil --provider gemini --model gemini-3.6-flash   # one-run overrides
ANVIL_PROVIDER=anthropic ANVIL_MODEL=claude-sonnet-5 anvil
```

Selection precedence: CLI flag → env var → `~/.anvil/settings.json` → first configured provider.
An explicitly selected provider that has no configured API key fails with an actionable error;
it never silently falls back to another provider.

### Supported Providers & Certification (Phase 18)

Every model provider adapter undergoes strict verification across 5 criteria: streaming text deltas, tool calling round-trips, 3-turn context continuity, clean error containment (404/invalid model), and rate-limit/circuit-breaker resilience (`npm run certify`).

| Provider | Environment Variable / Key | Free Tier | Primary Certified Models | Tools | Vision | Status |
|---|---|---|---|---|---|---|
| **Anthropic** | `ANTHROPIC_API_KEY` | Paid | `claude-sonnet-5`, `claude-3-7-sonnet-20250219`, `claude-3-5-sonnet-20241022`, `claude-3-5-haiku-20241022` | Yes | Yes | ✅ live* |
| **OpenAI** | `OPENAI_API_KEY` | Paid | `gpt-4o`, `gpt-4o-mini`, `o3-mini` | Yes | Yes | ✅ live* |
| **Google Gemini** | `GEMINI_API_KEY` | Free & Paid | `gemini-3.6-flash` (verified 2026-09-18), `gemini-2.0-flash`  retired by Google, `gemini-1.5-pro`, `gemini-1.5-flash` (unverified) | Yes | Yes | ✅ live (see note) |
| **OpenRouter** | `OPENROUTER_API_KEY` | Free & Paid | `openrouter/free`, `google/gemma-4-31b-it:free` | Yes | Yes | ✅ live |
| **Orcarouter** | `ORCAROUTER_API_KEY` | Free & Paid | `orcarouter/free`, `z-ai/glm-5.3-flash-free`, `deepseek/deepseek-v4-flash-free` | Yes | Yes | ✅ live |
| **Groq** | `GROQ_API_KEY` | Free Tier | `llama-3.3-70b-versatile`, `llama-3.1-8b-instant`, `qwen-2.5-coder-32b` | Yes | No | ✅ live |
| **GitHub Models** | `GITHUB_TOKEN` / PAT | Free Preview | `gpt-4o-mini`, `meta-llama-3.3-70b-instruct`, `mistral-large-2411` | Yes | Mini: Yes | ✅ live |
| **Cerebras** | `CEREBRAS_API_KEY` | Free Tier (1M/day) | `llama3.3-70b`, `llama3.1-8b` | Yes | No | ✅ live |
| **Mistral AI** | `MISTRAL_API_KEY` | Free Experimentation | `codestral-latest`, `mistral-small-latest` | Yes | No | ✅ live |
| **Ollama** | None / `OLLAMA_HOST` | 100% Free / Local | `qwen2.5-coder:latest`, `llama3.2:latest` | Yes | Model-dependent | ✅ live |

Status `✅ live` means the adapter passes all 5 criteria; `*` marks providers whose two newest models (`claude-opus-5`, `gpt-5.1`) are still `untested`. CI runs the deterministic mock suite; the weekly live lane (`live-eval.yml`) re-certifies against real providers and uploads the matrix (`--out`).

Re-run provider certification anytime:
```bash
npm run certify -- --mock --all   # instant deterministic mock pass
./scripts/certify-all.sh          # runs all providers with configured keys
```

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
| `/model` | open the model/provider picker (type to filter; cross-provider switches clear history) |
| `/theme <name>` | switch theme (built-in or custom); persisted |
| `/session list` | list saved sessions |
| `/session new` | start a fresh session |
| `/session resume [id]` | resume a session (no id → interactive picker) |
| `/session rename <title>` | rename the current session |
| `/goal <objective>` | launch an autonomous multi-step mission (decompose → execute → verify → critique) |
| `/image <path>` | attach a png/jpeg/webp/gif (max 5 MB) to your next message (vision models) |
| `/retry <text>` | drop the last exchange and resend with corrected wording |
| `/diff` | review every file the session touched as unified diffs |
| `/mcp` | MCP server status (tools, health) |
| `/mcp reconnect` | reconnect + refresh all MCP servers (new tools are hot-loaded into the running session) |
| `/team` | Multi-agent team status (parallel / pipeline / review) |
| `/plugin` | Plugin registry (`/plugin list`; `/plugin lsp` shows language servers) |
| `/context` | Token budget breakdown + compaction forecast |
| `/copy` | Copy the newest code block to the clipboard (OSC 52, SSH-safe) |

Keys: **Esc** or **Ctrl+C** cancels a streaming turn; **Ctrl+C** while idle exits; **Up/Down** in
an empty input recalls messages you sent this session; typing **/** opens the command menu.

## Safety notes

- **Read-only commands don't prompt — the auto-allow is scoped, not assumed.** Two classes
  skip the prompt: *project-contained readers* (`ls`, `cat`, `head`, `wc`, `file`, `du`,
  `git status`, `git diff`, `npm ls`, …), whose path arguments must resolve inside the
  project root — `~`/`$HOME` and out-of-tree absolute paths fail closed, and escaping flags
  such as `git diff --no-index` / `--output` are refused — and *inert printers* with no path
  semantics (`pwd`, `echo`, `date`, `uname`, `node --version`). Anything not positively on
  that list — including any command containing a shell metacharacter (`|`, `&&`, `>`, `$()`,
  globs) — goes through the normal permission prompt. Auto-allows are recorded in the run
  ledger (`/ledger`), never silent.
- **That containment is lexical, and the destructive-command filter is pattern matching.**
  Unlike the file tools (which resolve the deepest existing component physically, symlinks
  included), the safe-list compares resolved paths textually; both it and the refusal list
  below are best-effort defense in depth behind the permission prompt — a usability policy,
  not a sandbox.
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
- Compaction is proactive on resume (a chars/4 estimate decides whether to summarize before the
  first request) and reactive between turns. It is deliberately conservative: it summarizes only
  when there is an older region outside the recent-message window, and **refuses as a no-op** when
  the history is already just a few messages — so a single enormous message, or a handful of them,
  can still exceed the context window in one hop rather than being half-rewritten. What it does
  guarantee: the history it hands back never splits a tool call from its result and never puts two
  messages of the same role in a row, whatever the model returns.

## How this was built

Anvil was built phase-by-phase against a written spec; each phase has a doc with goals, exact
file lists, interfaces, and acceptance criteria:

- `Phases 0–7` — monorepo scaffold, provider abstraction layer, agent loop & tool
  system, TUI shell, permissions/slash commands/model picker, session
  persistence & context compaction, polish, and free & local model providers +
  live free-model sync (notes `docs/PHASE-3-NOTES.md`, `docs/PHASE-4-NOTES.md`,
  `docs/PHASE-5-NOTES.md`, `docs/PHASE-7-NOTES.md`)
- `Phase 8` — truthful engine + free-model radar (spec `docs/PHASE-8-SPEC.md`,
  progress `docs/PHASE-8-PROGRESS.md`)
- `Phase 9` — sub-agent delegation (spec `docs/PHASE-9-SPEC.md`,
  progress `docs/PHASE-9-PROGRESS.md`)
- `Phase 10` — MCP external tools, stdio only (spec `docs/PHASE-10-SPEC.md`,
  progress `docs/PHASE-10-PROGRESS.md`)
- `Phases 11–16` — codebase intelligence (`get_outline`, project rules), headless mode
  (`-p`), closed-loop auto-verification, the goal engine, the cockpit UI, and hardening
  (specs and records in `docs/`; the multi-phase roadmap lives in `docs/ROADMAP.md`)
- `Phases 0, 17–20` — visual regression testing, the agent eval harness, provider
  certification, project memory & git workflow, and distribution & CI
  (spec `docs/PHASE-0-VISUAL-REGRESSION-SPEC.md`, progress `docs/PHASE-17-PROGRESS.md`,
  `docs/PHASE-18-PROGRESS.md`, `docs/PHASE-19-PROGRESS.md`, `docs/PHASE-20-PROGRESS.md`)

## MCP servers (Phase 10 + 25.1)

Anvil can call tools from local MCP servers (stdio) and remote ones (SSE).
Create `~/.anvil/mcp.json` (or `$ANVIL_HOME/mcp.json`, mode 0600 if you put
secrets in `env` or `headers`):

```json
{
  "servers": {
    "my-tools": {
      "command": "node",
      "args": ["./mcp-server.js"],
      "env": { "MY_TOKEN": "..." },
      "timeoutMs": 60000
    },
    "cloud-tools": {
      "transport": "sse",
      "url": "https://mcp.example.com/sse",
      "headers": { "Authorization": "Bearer ..." },
      "timeoutMs": 30000
    }
  }
}
```

Server tools appear as `mcp_<server>__<tool>`, gated by the normal permission
prompt (unknown external tools are treated as mutating unless the server
marks them read-only). `/mcp` shows per-server health and transport;
`/mcp reconnect` refreshes connections.

Boundaries, stated plainly:

- **Transports: stdio + SSE.** `https://` required for remote URLs (plain
  `http://` only for localhost). Auth goes in `headers`, never in logs.
- **SSE keeps its requests on the origin you configured.** The server's `endpoint`
  event decides where Anvil POSTs, so an off-origin endpoint is refused rather than
  handed your headers, and redirects are refused in both directions. Each event
  frame and response body is size-capped, so a broken or hostile server cannot grow
  Anvil's memory without limit.
- **No undo.** MCP and shell actions can't be rewound — only local file
  writes (`/rewind`).
- **Servers see tool arguments.** Anything the model sends a server tool
  (file contents included) is visible to that server. Only connect to
  servers you trust, same as any local dev tool.

## Custom themes

Define your own themes in `~/.anvil/themes.json` (or `$ANVIL_HOME/themes.json`):

```json
{
  "ember": {
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
      "surface": "gray",
      "brand": "#ff6ec7"
    },
    "spacing": { "panelPaddingX": 1, "panelPaddingY": 0 },
    "borders": { "panel": "double" }
  }
}
```

All 11 legacy color keys are required (named chalk colors or hex). The 15
semantic colors (`brand`, `success`, `error`, `borderFocus`, …) plus the
`typography`, `spacing`, `borders`, and `responsive` sections are optional —
omitted values derive from your legacy keys with built-in defaults, so old
theme files keep loading unchanged. Names must be `[a-z0-9-_]` and must not
shadow built-ins (`dark`, `light`, `highContrast`, `midnight`, `hacker`).
Invalid entries are reported (never half-loaded) — run `/theme` with no args
to see available names plus any problems. Select with `/theme ember`.

## Development

```bash
npm install
npm run build      # build core → tui → cli (cli bundles to a self-contained dist via esbuild)
npm run typecheck  # strict TS across all packages
npm test           # vitest suite (core)
npm run dev        # run the CLI from source
```
