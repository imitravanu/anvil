# PHASE 12 SPEC — Headless Automation & Unix Pipeline Runner

> **Status:** APPROVED & IN IMPLEMENTATION (Directive: "conitue", 2026-09-06)  
> **Author:** Chief Engineer  
> **Target:** Anvil v0.6.0  

---

## 0. Objective

Turn Anvil from an interactive-only TUI app into a dual-mode Unix agent capable of scriptable execution, stdin stream piping, and headless CI/CD automation without mounting React/Ink.

---

## 1. Specification & Architecture

### 1.1 CLI Flags & Invocations

- `-p, --prompt <string>`: Headless prompt string. When present, Anvil enters headless runner mode.
- `-y, --yes`: Non-interactive auto-approval for mutating tools (`write_file`, `edit_file`, `run_command`).
- `--raw`: Pure stdout output (suppresses stderr tool notices).
- Piped stdin: When `!process.stdin.isTTY`, Anvil reads stdin to EOF.
  - If `--prompt` is also provided, context is concatenated: `[Input from stdin]\n<stdin>\n\n<prompt>`.
  - If `--prompt` is not provided, the piped stdin becomes the prompt.

### 1.2 Stream Separation (Unix Philosophy)

- **`stdout`**: Pure assistant text deltas stream as received. Pipeable directly into `jq`, `patch`, `grep`, or files.
- **`stderr`**: Tool activity diagnostics:
  - `⚙ [tool_name] <preview>` on start.
  - `✓ [tool_name] <summary>` on completion.
  - `✗ [tool_name] <error>` on denial/error.
  (Suppressed when `--raw` is active).

### 1.3 Security & Permission Policy

- If `-y, --yes` is set: Uses [`AUTO_APPROVE_BROKER`](file:///home/mitravanu/Projects/anvil/packages/core/src/agent/types.ts#L11-L15).
- If `-y, --yes` is NOT set:
  - Read-only tools (`read_file`, `list_files`, `grep`, `get_outline`, safe read-only bash) execute normally.
  - Mutating tools are refused with:  
    `"Permission denied: Mutating tool '<name>' requires --yes in non-interactive mode."`
  - Prevents unintended filesystem writes or commands when running in unattended CI pipelines.

### 1.4 Exit Codes

- `0`: Turn completed successfully (`turn_complete`).
- `1`: Unhandled error, rate limit circuit breaker open, or provider configuration error.
- `130`: Terminated via `SIGINT` (Ctrl+C).

---

## 2. Acceptance Criteria

- **H1:** `anvil -p "Say hello"` outputs model text to stdout and exits with code 0.
- **H2:** `echo "input" | anvil -p "summarize"` consumes stdin and augments prompt.
- **H3:** Mutating tools without `-y` are rejected with security notice; safe tools proceed.
- **H4:** Mutating tools with `-y` are approved and executed.
- **H5:** Tool diagnostics route to `stderr`, leaving `stdout` clean.
- **H6:** Full test suite green across all workspaces.
