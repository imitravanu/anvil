# Phase 22: Bug Fix Sweep (v0.9.1) Progress Report

> **Date:** 2026-09-13  
> **Status:** COMPLETED  
> **Version:** 0.9.0 → 0.9.1  
> **Branch:** master  
> **Chief Engineer:** Antigravity  

---

## 1. Executive Summary

Phase 22 sweeps logic bugs that caused silent data loss, unhandled crashes, or incorrect behavior across core agent sessions, tool execution, model adapters, and the TUI command registry. In accordance with the Pre-Execution Audit protocol and Standing Rule 7.8, failing tests were authored first in `packages/core/src/agent/__tests__/phase22.test.ts` and `packages/tui/src/commands/__tests__/registry.test.ts` before applying fixes.

All 16 audit items for Phase 22 were systematically inspected, verified, or corrected. Monorepo builds, strict typechecks, and 581 unit tests are clean and passing.

---

## 2. Bug Fix Details & Architectural Rationale

### 22.1 — Cancellation Signal Lost Before First `send()`
- **File:** `packages/core/src/agent/session.ts`
- **Issue:** Calling `session.cancel()` before `send()` had initialized a turn controller was a silent no-op, allowing queued or delayed sends to run unchecked.
- **Fix:** Added `pendingCancel: boolean` to `AgentSession`. If `cancel()` is called while `currentController` is null, `pendingCancel` is set to `true`. On turn start in `send()`, if `pendingCancel` is active, the newly created `AbortController` is aborted immediately.
- **Verification:** Verified by `packages/core/src/agent/__tests__/cancelHistory.test.ts`.

### 22.2 — Malformed Tool Call JSON Error Feedback
- **Files:** `packages/core/src/agent/session.ts`, `packages/core/src/tools/index.ts`, `packages/core/src/agent/orchestrator.ts`
- **Issue:** `JSON.parse` failures on tool arguments defaulted silently to `{}`, causing tools to execute with empty arguments without the model knowing syntax was invalid.
- **Fix:** In `session.ts`, JSON parse catch blocks set `{ __parseError: true, rawInput: raw.slice(0, 200) }`. In `tools/index.ts` (`executeTool`) and `orchestrator.ts`, objects with `__parseError` return `isError: true` containing the syntax error details without prompting for permission.
- **Verification:** Verified by test `22.2 - Malformed Tool Call JSON` in `phase22.test.ts`.

### 22.3 — Gemini Compacted History Orphan Tool Result Crash
- **File:** `packages/core/src/providers/gemini.ts`
- **Issue:** When context compaction truncated older turns, orphaned tool results lacked a corresponding tool call in the active window. Emitting a placeholder `"unknown_tool"` caused Gemini API 400 validation failures.
- **Fix:** In `toGeminiContents`, if `callNames.get(c.result.toolCallId)` is not found, the orphaned tool result is cleanly skipped (`continue`).
- **Verification:** Verified by test `22.3 - Gemini Compaction Orphan Tool Result` in `phase22.test.ts`.

### 22.4 — Free Model Registry Pricing Check Heuristic
- **File:** `packages/core/src/providers/freeModels.ts`
- **Issue:** Strict string check `=== "0"` failed for decimal representations like `"0.0"`, `"0.00"`, or numeric `0`.
- **Fix:** Converted `promptPrice` and `completionPrice` to numbers, verifying both are `0` alongside presence of pricing data (`m.pricing != null`).
- **Verification:** Verified by test `22.4 - Free Model Pricing Heuristic` in `phase22.test.ts`.

### 22.5 — Goal Engine Review Verdict Parsing Strictness
- **File:** `packages/core/src/agent/goal/goalEngine.ts`
- **Issue:** Critic verdicts like `"YES."`, `"YES\n- looks good"`, or `"YES, all criteria met"` were rejected as invalid.
- **Fix:** Updated matching to `startsYes = /^YES\b/i.test(reviewVerdict)` while checking and rejecting explicit hedges (`/^YES\s*[,]\s*(but|however|although|except|unfortunately)/i`).
- **Verification:** Verified by test `22.5 - Goal Review Verdict Parsing` in `phase22.test.ts`.

### 22.6 — Binary File Detection in `read_file`
- **File:** `packages/core/src/tools/readFile.ts`
- **Issue:** Reading binaries (`.png`, `.wasm`, `.so`) dumped garbage UTF-8 replacement tokens into the context window.
- **Fix:** Sniffed the first 8KB of the buffer for null bytes (`\0`). If found, returns an `isError: true` result indicating binary file contents cannot be displayed as text.
- **Verification:** Verified by test `22.6 - Binary File Detection in read_file` in `phase22.test.ts`.

### 22.7 — Ollama Keyless Provider Selection
- **File:** `packages/core/src/config/index.ts`
- **Issue:** Requiring non-empty API keys for all providers prevented selecting keyless Ollama via `--provider ollama`.
- **Fix:** Added `KEYLESS_PROVIDERS = new Set(["ollama"])`. When a provider is explicitly requested, keyless providers are allowed. For implicit default fallback without explicit provider selection, only providers with non-empty API keys are considered, correctly preserving first-run onboarding when `creds: {}`.
- **Verification:** Verified by test `22.7 - Ollama Keyless Selection` in `phase22.test.ts` and `config.test.ts`.

### 22.8 — Vision Filtering on Non-Vision Providers
- **Files:** `packages/core/src/providers/openai.ts`, `groq.ts`, `cerebras.ts`, `mistral.ts`
- **Issue:** `ChatCompletionsStyleProvider` blindly forwarded base64 image data to providers without multi-modal support.
- **Fix:** Added `supportsVision?: boolean` (default `true`) to options and class. Set `supportsVision: false` on Groq, Cerebras, and Mistral. `toOpenAIMessages` filters images out and inserts `[Image omitted — this provider does not support vision]` when vision is unsupported.
- **Verification:** Verified by test `22.8 - Vision Filtering on Non-Vision Providers` in `phase22.test.ts`.

### 22.9 — Checkpoint Store Error Logging
- **File:** `packages/core/src/agent/checkpointStore.ts`
- **Issue:** Silent `catch { return []; }` dropped corrupted checkpoint errors with zero diagnostics.
- **Fix:** Added diagnostic warning logging via `console.error` and `getErrorMessage(err)` when file operations fail on an existing checkpoint file, while safely preserving non-crashing fallback behavior.
- **Verification:** Verified by test `22.9 - Checkpoint Store Corrupt File Containment` in `phase22.test.ts`.

### 22.10 — Asynchronous Directory Introspection in `analyzeWorkspace`
- **File:** `packages/core/src/agent/goal/awareness.ts`
- **Issue:** `fs.readdirSync(projectRoot)` ran synchronously within an async introspection method.
- **Fix:** Replaced with `await fs.promises.readdir(projectRoot)`.
- **Verification:** Verified by test `22.10 - analyzeWorkspace async readdir` in `phase22.test.ts`.

### 22.11 — TUI Permission Broker Subscription Evaluation
- **File:** `packages/tui/src/permission/TuiPermissionBroker.ts`
- **Status:** Evaluated and kept as synchronous by design. In the TUI, `usePermissionBroker` subscribes via `useEffect`, which runs post-render and does not cause render conflicts. Deferring listener invocation would break the synchronous snapshot contract and cause tests in `broker.test.ts` to fail.

### 22.12 — Session Rename State Synchronization
- **File:** `packages/tui/src/commands/registry.ts`
- **Issue:** `/session rename <title>` updated the JSON session file on disk but failed to mutate `session.title` on the active in-memory `AgentSession`. The next auto-save immediately reverted the rename.
- **Fix:** Added `session.title = title;` to the `sessionRename` command handler.
- **Verification:** Verified by unit tests in `packages/tui/src/commands/__tests__/registry.test.ts`.

### 22.17 — MCP Boot Notices Silently Dropped in TUI
- **File:** `packages/tui/src/components/App.tsx`
- **Issue:** When `~/.anvil/mcp.json` had a syntax error or a server failed to connect, notices passed to `<App mcp={{ notices }} />` were accepted as props but never printed to system messages on mount.
- **Fix:** Added a startup `useEffect` in `App.tsx` iterating over `mcp?.notices` and printing each warning banner via `printSystemMessage("⚠ ...")`.
- **Verification:** Verified by unit test in `packages/tui/src/components/__tests__/app.test.tsx`.

### 22.13 — Free Model Demotion on Empty Response
- **File:** `packages/core/src/providers/freeModels.ts`
- **Status:** **BY-DESIGN (DO NOT FIX)** per Chief Engineer Audit. Demoting on empty API response would wipe the user's free model registry during network outages or transient API hiccups.

### 22.14 — Tool Abort Handling in Orchestrator
- **File:** `packages/core/src/agent/orchestrator.ts`
- **Status:** Verified already implemented. `orchestrator.ts` contains explicit guards checking `signal.aborted || (err instanceof Error && err.name === "AbortError")` across both serial and concurrent execution paths.

### 22.15 & 22.16 — Subagent Checkpoints and Eval Runner Timeout
- **Status:** Verified already implemented in the live codebase prior to Phase 22 (`drainCheckpoints()` in `subagent.ts` and `session.cancel()` in `eval/runner.ts`).

---

## 3. Verification & Metrics

- **Monorepo Build:** Success across `@anvil/core`, `@anvil/tui`, and `@anvil/cli`.
- **TypeScript Typecheck:** 0 errors.
- **Unit Tests:** **581 passed (581 total)** across all workspaces.
- **Visual Baselines:** Updated `packages/tui/__visual-baselines__/empty-state.txt` for `v0.9.1`.
- **Changelog:** Updated `CHANGELOG.md` with `## [0.9.1] — 2026-09-13`.
