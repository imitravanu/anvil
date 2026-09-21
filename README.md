<p align="center">
  <img src="assets/banner.svg" alt="Anvil Banner" width="100%">
</p>

<p align="center">
  <a href="https://github.com/imitravanu/anvil/releases"><img src="https://img.shields.io/badge/Release-v1.0.0-ff6a00?style=flat-square" alt="Version"></a>
  <a href="https://github.com/imitravanu/anvil/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/imitravanu/anvil/ci.yml?branch=master&style=flat-square&label=CI%20Build" alt="CI"></a>
  <a href="https://github.com/imitravanu/anvil/actions/workflows/visual-regression.yml"><img src="https://img.shields.io/github/actions/workflow/status/imitravanu/anvil/visual-regression.yml?branch=master&style=flat-square&label=Visual%20Gate" alt="Visual Gate"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node-%3E%3D20-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node"></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5.7-3178c6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript"></a>
  <a href="https://github.com/vadimdemedes/ink"><img src="https://img.shields.io/badge/TUI-React%20%2F%20Ink-61dafb?style=flat-square&logo=react&logoColor=black" alt="Ink"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-green?style=flat-square" alt="MIT License"></a>
</p>

<p align="center">
  <b>Anvil</b> is a professional-grade, terminal-based AI coding agent with an interactive React (Ink) terminal interface.<br>
  Featuring <b>11 LLM providers</b>, <b>15 autonomous tools</b>, interactive unified-diff permissions, LSP code intelligence, and file checkpoints.
</p>

---

## ⚡ Features at a Glance

- **Eleven Providers, One Unified Interface**: Seamlessly switch between Anthropic, OpenAI, Google Gemini, OpenRouter, Orcarouter, Groq, GitHub Models, Cerebras, Mistral AI, Inception, and local Ollama.
- **100% Free & Local Model Support**: Keep API costs at $0 using Groq, GitHub Models, Cerebras, Mistral experimentation, or fully offline Ollama. Every model is clearly labeled `[FREE]` or `[PAID]`.
- **Autonomous Agent Loop with 15 Tools**:
  - **Filesystem**: `read_file`, `write_file`, `edit_file` (unified diffs), `list_files`, `grep`.
  - **Code Intelligence (LSP)**: `get_outline`, `goto_definition`, `find_references`, `get_hover`, `get_diagnostics`.
  - **Execution & Memory**: `run_command`, `verify_tests`, `update_plan`, `delegate_task` (sub-agent), `update_memory`.
- **Interactive Unified Diff Permissions**: Every mutating tool shows the exact diff or command before execution (`Allow once` / `Always allow this session` / `Deny` / `Esc`). Safe read-only commands (`ls`, `cat`, `git status`) run automatically.
- **Model Picker with Live Search**: Filter through 49 built-in models plus live-synced OpenRouter free models mid-session via `/model`.
- **Session Checkpoints & Rewind**: Automatic pre-mutation snapshots allow full file rollbacks via `/rewind <n>`.
- **Context Compaction**: Summarizes older conversation regions when nearing model context windows without breaking tool-call continuity.
- **Extensible Architecture**: Native MCP (Model Context Protocol) support over `stdio` and `SSE`, sub-agent delegation, and custom themes.

---

## 🖥️ What It Looks Like

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

---

## 🏗️ Architecture

```
┌────────────────────────────────────────────────────────┐
│                   @anvil/cli                           │
│     Entry point · Flag parsing · Sub-agent commands    │
└──────────────────────────┬─────────────────────────────┘
                           │
┌──────────────────────────▼─────────────────────────────┐
│                   @anvil/tui                           │
│    Ink (React) terminal UI · Interactive Diff Prompts  │
│    Model Picker · Command Palette · Ledger View        │
└──────────────────────────┬─────────────────────────────┘
                           │
┌──────────────────────────▼─────────────────────────────┐
│                   @anvil/core                          │
│    Autonomous Agent Loop · Provider Adapters (10)      │
│    15 Built-in Tools · LSP Client · Checkpoint Ring    │
│    Context Compaction · Session Store · MCP Client     │
└────────────────────────────────────────────────────────┘
```

---

## 🚀 Installation

### Global Install via npm
```bash
npm install -g @anvil/cli

# Run inside any repository
cd ~/my-project
anvil
```

### Try Without Installing (npx)
```bash
npx @anvil/cli
```

### Build from Source
```bash
git clone https://github.com/imitravanu/anvil.git
cd anvil
npm ci
npm run build
npm test
```

---

## 🔑 First-Run Setup & Onboarding

The first time you launch `anvil` (or anytime via `anvil config`):
1. Pick a provider from the interactive list.
2. Paste your API key (stored securely in `~/.anvil/credentials.json`, `mode 0600`).
3. You are immediately dropped into the conversation.

> **Using Ollama?** Selecting Ollama requires **no API key**; it connects straight to `http://localhost:11434`.
> Free providers (Gemini, Groq, GitHub Models, Cerebras, Mistral, OpenRouter `:free`) are tagged `[FREE]`.

Hot-swap providers or keys anytime without leaving the chat using `/connect`.

---

## 📡 Supported Providers & Certified Models

| Provider | Environment Variable | Tier | Primary Certified Models | Tools | Vision |
| :--- | :--- | :---: | :--- | :---: | :---: |
| **Anthropic** | `ANTHROPIC_API_KEY` | Paid | `claude-sonnet-5`, `claude-3-7-sonnet`, `claude-3-5-sonnet` | Yes | Yes |
| **OpenAI** | `OPENAI_API_KEY` | Paid | `gpt-4o`, `gpt-4o-mini`, `o3-mini` | Yes | Yes |
| **Google Gemini** | `GEMINI_API_KEY` | Free & Paid | `gemini-3.6-flash`, `gemini-1.5-pro` | Yes | Yes |
| **OpenRouter** | `OPENROUTER_API_KEY` | Free & Paid | `openrouter/free`, `google/gemma-4-31b-it:free` | Yes | Yes |
| **Orcarouter** | `ORCAROUTER_API_KEY` | Free & Paid | `orcarouter/free`, `deepseek/deepseek-v4-flash-free` | Yes | Yes |
| **Groq** | `GROQ_API_KEY` | Free Tier | `llama-3.3-70b-versatile`, `qwen-2.5-coder-32b` | Yes | No |
| **GitHub Models** | `GITHUB_TOKEN` | Free Preview | `gpt-4o-mini`, `meta-llama-3.3-70b-instruct` | Yes | Yes |
| **Cerebras** | `CEREBRAS_API_KEY` | Free Tier (1M/day) | `llama3.3-70b`, `llama3.1-8b` | Yes | No |
| **Mistral AI** | `MISTRAL_API_KEY` | Free Experimentation | `codestral-latest`, `mistral-small-latest` | Yes | No |
| **Inception** | `INCEPTION_API_KEY` | Free Trial (100M tokens) | `mercury-2.5`, `mercury-2` | Yes | No |
| **Ollama** | None / `OLLAMA_HOST` | 100% Free / Local | `qwen2.5-coder:latest`, `llama3.2:latest` | Yes | Yes |

---

## ⌨️ Slash Commands

Type `/` at any prompt to open the autocomplete menu:

| Command | Description |
| :--- | :--- |
| `/help` | Display command help and usage guide |
| `/connect` | Hot-swap or configure a provider API key without restarting |
| `/model` | Open the interactive model picker with type-to-filter |
| `/diff` | Review all files modified during the current session as unified diffs |
| `/rewind [n]` | Inspect file checkpoints or rollback to snapshot `n` |
| `/goal <prompt>` | Launch an autonomous multi-step mission (Plan → Execute → Verify) |
| `/mcp` | Check status, tools, and health of connected MCP servers |
| `/mcp reconnect` | Refresh connections and hot-load new tools from MCP servers |
| `/theme <name>` | Switch theme (`dark`, `light`, `midnight`, `hacker`, or custom) |
| `/ledger` | Review session token spending, tools executed, and status |
| `/session list` | View, resume, or rename saved conversation sessions |
| `/context` | Inspect token budget breakdown and compaction forecasts |
| `/image <path>` | Attach an image (`png`, `jpeg`, `webp`) to vision-capable models |
| `/clear` | Start a fresh transcript (previous session remains saved) |

---

## 🔌 Model Context Protocol (MCP) Support

Anvil can connect to local (`stdio`) and remote (`SSE`) MCP servers. Configure servers in `~/.anvil/mcp.json`:

```json
{
  "servers": {
    "local-tools": {
      "command": "node",
      "args": ["./mcp-server.js"],
      "env": { "DEBUG": "true" },
      "timeoutMs": 60000
    },
    "cloud-tools": {
      "transport": "sse",
      "url": "https://mcp.example.com/sse",
      "headers": { "Authorization": "Bearer YOUR_TOKEN" },
      "timeoutMs": 30000
    }
  }
}
```
Server tools are exposed as `mcp_<server>__<tool>` and undergo the same strict permission gates as native tools.

---

## 🛡️ Safety & Containment

- **Path Containment:** All file operations are strictly confined to the project directory where Anvil was initiated, with symlink resolution.
- **Destructive Command Guard:** Catastrophic operations (`rm -rf /`, `rm -rf ~`, fork bombs, raw device writes) are refused automatically.
- **Size Capping:** File reads/writes are capped at 512 KiB; command outputs are capped at 20 KiB with a 2-minute timeout.
- **Rollback Snapshots:** Pre-mutation snapshots persist in `$ANVIL_HOME/checkpoints/` (mode `0600`) for non-destructive `/rewind`.
- **Zero Telemetry:** All sessions, settings, and credentials remain 100% local on your workstation.

---

## Guardian

Anvil ships a built-in hygiene system against AI slop (type escapes, silent catches, raw error formatting, stray placeholders):

- **Turn report:** after any turn with guardian activity, the TUI shows what was blocked, which rule fired, and what was auto-fixed. Headless mode prints a stable `guardian_blocked count=N fixed=M` stderr line.
- **`anvil gate [--full|--watch|--staged]`:** scans the working-tree diff (`--watch` re-scans continuously, `--staged` scans staged additions only, `--full` runs the full `npm run gate` pipeline).
- **`anvil health`:** per-project freshness, cleanliness, allowlist drain rate, and top blocked rules, tracked across sessions under `ANVIL_HOME/health/`.
- **`anvil init --guarded [--lang <id>]`:** provisions `AGENTS.md`, `.anvil/rules`, and a dependency-free pre-commit hook into any repo (TypeScript, Python, Rust, Go), so other agents' edits are gated too. Bypass once with `git commit --no-verify`.

Project-specific rules can be declared in a `guardian:rules` block. The model-agnostic proof matrix is tracked in `docs/PHASE-26-PROGRESS.md` — no pass-rate delta is claimed until a real paired live run exists.

---

## 🛠️ Development & Quality Gates

```bash
npm install

# Build all monorepo workspaces (core, tui, cli)
npm run build

# Typecheck with strict TypeScript compiler
npm run typecheck

# Run test suites across workspaces
npm test

# Visual regression tests (Ink TUI snapshots)
npm run visual

# Run provider certification suite
npm run certify -- --mock --all

# Launch local CLI in development mode
npm run dev
```

---

## 📄 License

Distributed under the [MIT License](LICENSE) — Copyright (c) 2026 Mitravanu.
