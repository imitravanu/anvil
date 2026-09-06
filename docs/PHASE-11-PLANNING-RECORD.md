# PHASE 11 PLANNING RECORD — Next-Generation Agent Capabilities & Evolution Roadmap

> **Status:** PROPOSED ARCHITECTURAL BLUEPRINT (Awaiting Client Direction & Phase Approval)  
> **Date:** 2026-09-06  
> **Author:** Chief Engineer  
> **Baseline System:** Anvil v0.5.1 (253 tests passing across `@anvil/core` and `@anvil/tui`, clean build, 0 type errors)

---

## 0. Executive Summary & Context

Anvil v0.5.1 provides a robust, resilient agent core: multi-provider streaming across 9 adapters, interactive permission gating with word-level unified diffs, synthetic history repair on abort, persistent rewind checkpoints, single-depth sub-agent delegation (Phase 9), extensible JSON-RPC 2.0 stdio MCP client (Phase 10), and vision input.

With the core mechanics hardened, Anvil's next leap is evolving from a **terminal-based LLM chat with tools** into an **autonomous, deep-context developer coworker** comparable to Claude Code, Aider, and Cursor.

This document establishes the official planning record and architectural blueprint for the next major milestone (**Phase 11**), organizing prospective initiatives into clear tracks, identifying verified code seams, enforcing non-goals, and defining the acceptance scorecard.

---

## 1. Verified Code Seams (Tree Audit as of 2026-09-06)

Every proposed capability is anchored to existing seams in the codebase:

1. **System Prompt & Configuration Seam:**
   - `AgentOptions.systemPrompt` and `AgentSession` constructor (`packages/core/src/agent/session.ts`) accept static system strings. Project-level rule discovery (`.anvil/rules` or `AGENTS.md`) can augment this prompt at session instantiation without touching provider adapters.
2. **Tool Dispatch & External Execution Seam:**
   - `registerExternalExecutor` (`packages/core/src/tools/index.ts`) and `AgentOptions.tools` allow dynamically injecting new native tools (e.g., `repo_map`, `git_commit`) or LSP bridges.
3. **Execution Sandbox Seam:**
   - `packages/core/src/tools/bash.ts` controls subprocess spawning. Bubblewrap (`bwrap`) or containerized isolation can wrap the `spawn("bash", ...)` invocation cleanly at this single junction.
4. **TUI Input & Autocomplete Seam:**
   - `packages/tui/src/components/InputBar.tsx` manages terminal text input and keybindings. Autocomplete overlays (`@file` and slash commands) attach directly to `onChange` and `onSubmit` hooks without disturbing the transcript.
5. **Headless / Non-TTY Seam:**
   - `packages/cli/src/index.tsx` contains an explicit `!process.stdin.isTTY` check that currently exits with an error. Diverting non-TTY invocations to a headless execution runner requires no changes to `@anvil/core`.

---

## 2. Capability Tracks Breakdown

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          PHASE 11 TRACK MATRIX                              │
├──────────────────────────┬──────────────────────────┬───────────────────────┤
│ Track A: Context & AST   │ Track B: TUI Ergonomics  │ Track C: Isolation    │
├──────────────────────────┼──────────────────────────┼───────────────────────┤
│ • Tree-sitter Repo Map   │ • @file Path Autocomplete│ • Linux bwrap sandbox │
│ • Project .anvil/rules   │ • Git-native tools       │ • Atomic Multi-File   │
│ • LSP Definition Jump    │ • Post-edit lint hook    │   Transactions        │
└──────────────────────────┴──────────────────────────┴───────────────────────┘
```

### Track A: Codebase Intelligence & Context Efficiency (Highest ROI)

*Problem:* For repositories exceeding 500 files, the agent burns tokens and inner iterations running repetitive `list_files`, `grep`, and speculative `read_file` queries to locate symbols.

*Proposed Deliverables:*
1. **Tree-sitter Workspace Outline (Repo Map):**
   - Extract top-level symbols (functions, classes, interfaces, method signatures) across source files into a compact structural summary (~500–1,500 tokens).
   - Injected into context or exposed via a read-only `get_outline` tool.
   - Slashes exploratory token spend by up to 70%.
2. **Project Memory & Custom Instructions (`.anvil/rules` / `AGENTS.md`):**
   - Read local configuration instructions from the workspace root (`.anvil/rules`, `AGENTS.md`, or `.cursorrules`).
   - Automatically appended to the system prompt to enforce project-specific coding styles, preferred build tools, and testing commands.
3. **LSP Navigation Bridge (Language Server Protocol):**
   - Lightweight stdio JSON-RPC bridge (leveraging the Phase 10 transport architecture) to local language servers (`typescript-language-server`, `gopls`, `pyright`).
   - Adds pinpoint `goto_definition` and `find_references` tools.

---

### Track B: Terminal Ergonomics & Developer Workflow

*Problem:* Users must manually type exact relative paths, frequently switch windows to stage git commits, and manually verify that agent edits didn't introduce lint regressions.

*Proposed Deliverables:*
1. **Interactive Path Autocomplete (`@file` mentions):**
   - Typing `@` in `InputBar` opens an inline, searchable list of workspace files.
   - Hitting `Tab` autocompletes the relative path into the prompt buffer.
2. **Native Git Collaboration Tools:**
   - Dedicated tools: `git_stage`, `git_commit` (with AI-generated conventional commit summaries), and `git_diff_staged`.
   - Bypasses raw shell ambiguity while preserving the permission prompt for commits.
3. **Post-Mutation Verification Hooks:**
   - Configurable in `~/.anvil/settings.json` or `.anvil/rules` (e.g., `"onEdit": "npm run lint -- --fix"`).
   - Automatically executes after `edit_file` / `write_file` mutations; any generated linter errors feed directly back into the next agent turn.

---

### Track C: Execution Isolation & Transactional Integrity

*Problem:* Approved shell commands run with full host user permissions. Multi-file refactors can partially fail midway, leaving the working tree in a broken intermediate state.

*Proposed Deliverables:*
1. **Linux Bubblewrap Sandbox (`bwrap`):**
   - When enabled (`--sandbox`), isolates `run_command` in a mount namespace:
     - Read-only mounts for system binaries (`/usr`, `/bin`, `/lib`).
     - Read-write access strictly confined to `projectRoot`.
     - Blocked network access unless explicitly allowed.
2. **Turn-Level Atomic File Transactions:**
   - Upgrade the rewind checkpoint ring to support multi-file transaction boundaries. If turn iteration $N$ fails or is aborted during a multi-file edit, all modified files revert cleanly to turn start.

---

### Track D: Automation & Headless Pipeline Mode

*Problem:* Anvil currently requires an interactive TTY, preventing headless execution in CI/CD, git hooks, or shell scripting.

*Proposed Deliverables:*
1. **Non-Interactive Execution (`anvil --prompt <text>`):**
   - Runs a single-turn or bounded multi-turn task without mounting Ink.
   - Streams formatted Markdown to `stdout`, diagnostic logs to `stderr`.
2. **Standard Stream Pipe Support:**
   - Allows piping context directly: `git diff | anvil --prompt "Review this diff"`.

---

## 3. Strict Architectural Non-Goals

To maintain Anvil's fast startup (<50ms) and zero-bloat standard:
- **NO Heavy Native Binaries:** Tree-sitter parsers must use pre-built wasm or lightweight bindings; no native compilation hurdles for users.
- **NO Remote Telemetry or Cloud Dependencies:** All intelligence, indexing, and checkpoints remain 100% local.
- **NO Breaking Changes to Existing Seams:** All Phase 8–10 contracts (`AgentOptions`, `PermissionBroker`, `RunLedgerEntry`, checkpoint storage) must remain backward-compatible.
- **NO Unbounded Daemon Processes:** Background file indexing must be lazy or bounded; Anvil must never leave persistent background indexer daemons running after process exit.

---

## 4. Phasing Recommendation & Execution Roadmap

| Release | Focus | Target Scope |
|---|---|---|
| **Phase 11.0** (Immediate) | **Context Intelligence & Rules** | `.anvil/rules` system prompt injection + Tree-sitter Repo Map tool |
| **Phase 11.5** (Ergonomics) | **TUI Path Autocomplete & Git Tools** | `@file` autocomplete in `InputBar` + `git_commit` / `git_diff_staged` |
| **Phase 12.0** (Hardening & Automation) | **Sandbox & Headless Mode** | Bubblewrap Linux sandbox + Headless CLI runner (`--prompt`, pipe stdin) |

---

## 5. Verification & Acceptance Criteria (Phase 11 Gate)

For Phase 11 acceptance, any implementation must satisfy:
1. `npm run typecheck` across `@anvil/core`, `@anvil/tui`, `@anvil/cli` with **0 errors**.
2. Full test suite green with zero regressions (253 existing tests + new unit & integration coverage).
3. Zero stray child processes on termination (`SIGINT`, `SIGTERM`, `SIGHUP`, `exit`).
4. Standalone binary packaging via esbuild succeeds without bundle bloat.
