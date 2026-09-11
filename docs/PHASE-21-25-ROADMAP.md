# Anvil — Phases 21–25 Roadmap & Agent Build Guide

> **Version:** 0.8.0 → 1.0.0  
> **Date:** 2026-09-11  
> **Author:** Chief Engineer Audit  
> **Origin:** Deep codebase audit of all 213 source files across `@anvil/core`, `@anvil/tui`, `@anvil/cli`  
> **Purpose:** This document is the **actionable build guide** for any agent working on Anvil. Every task has exact file paths, line numbers, broken code, fix instructions, and acceptance criteria. Phases are sequenced — **do not skip ahead**.

---

## Table of Contents

1. [Sequencing Rule](#1-sequencing-rule)
2. [Phase 21 — Security Hardening (v0.9.0)](#2-phase-21--security-hardening-v090)
3. [Phase 22 — Bug Fix Sweep (v0.9.1)](#3-phase-22--bug-fix-sweep-v091)
4. [Phase 23 — Stability & Performance (v0.10.0)](#4-phase-23--stability--performance-v0100)
5. [Phase 24 — Refinement & Tech Debt (v0.11.0)](#5-phase-24--refinement--tech-debt-v0110)
6. [Phase 25 — Next-Gen Evolution (v1.0.0)](#6-phase-25--next-gen-evolution-v100)
7. [Standing Rules for All Agents](#7-standing-rules-for-all-agents)
8. [Verification Gate (Run After Every Phase)](#8-verification-gate-run-after-every-phase)

---

## 1. Sequencing Rule

```
Phase 21 (security) → Phase 22 (bugs) → Phase 23 (stability) → Phase 24 (refinement) → Phase 25 (next-gen)
```

**Why this order matters:**
- Phase 21 fixes **sandbox escapes** — nothing else ships until the security model is sound.
- Phase 22 fixes **logic bugs** that cause silent data loss or crashes — correctness before polish.
- Phase 23 eliminates **silent failures and performance regressions** — the app must be stable before adding features.
- Phase 24 removes **tech debt** — clean foundation before building next-gen on top.
- Phase 25 adds **new capabilities** — only on a proven, stable, clean codebase.

**CAUTION:** Do NOT start Phase 25 features before Phases 21–24 are complete and all tests pass. Feature sprawl on a buggy foundation is how the current problems accumulated.

---

## 2. Phase 21 — Security Hardening (v0.9.0)

> **Priority:** CRITICAL — Fix before any public deployment  
> **Scope:** 3 security vulnerabilities in the tool sandbox  
> **Files touched:** `packages/core/src/tools/bash.ts`, `packages/core/src/tools/verifyTests.ts`  
> **Estimated effort:** 2–4 hours  
> **No new features. No refactors. Only security fixes.**

### 21.1 — Shell Quote Path Traversal Bypass in `run_command`

**File:** `packages/core/src/tools/bash.ts`  
**Function:** `pathsInsideRoot()` (line 151–163)  
**Severity:** CRITICAL — allows reading arbitrary host files without permission prompt

**The bug:**
The `pathsInsideRoot` function checks if command arguments stay within the project root before auto-allowing read-only commands. It does NOT strip shell quotes from arguments.

```typescript
// bash.ts:158 — CURRENT (BROKEN)
const resolved = path.isAbsolute(arg) ? path.resolve(arg) : path.resolve(root, arg);
```

**Attack vector:** If the AI sends `cat "/etc/passwd"`:
1. `arg` = `"/etc/passwd"` (with quotes)
2. `path.isAbsolute('"/etc/passwd"')` returns `false` (starts with `"` not `/`)
3. Resolves to `/project-root/"/etc/passwd"` — passes the root check
4. But `bash -c 'cat "/etc/passwd"'` strips quotes and reads the real `/etc/passwd`

**Fix instructions:**
1. Add a quote-stripping step at the top of `pathsInsideRoot`:

```typescript
function stripShellQuotes(s: string): string {
  // Remove matching outer quotes (single or double)
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

function pathsInsideRoot(args: readonly string[], projectRoot: string): boolean {
  const root = path.resolve(projectRoot);
  for (const rawArg of args) {
    if (rawArg.startsWith("-")) continue;
    const arg = stripShellQuotes(rawArg);
    if (arg.startsWith("~") || arg.startsWith("$")) return false;
    // Also reject any remaining unmatched quotes — sign of shell trickery
    if (/['"]/.test(arg)) return false;
    const resolved = path.isAbsolute(arg) ? path.resolve(arg) : path.resolve(root, arg);
    const rel = path.relative(root, resolved);
    if (rel !== "" && (rel === ".." || rel.startsWith(`..${path.sep}`))) return false;
  }
  return true;
}
```

2. Do NOT change any other behavior in `bash.ts` in this phase.

**Acceptance criteria:**
- [ ] Unit test: `isReadOnlyCommand('cat "/etc/passwd"', '/project')` returns `false`
- [ ] Unit test: `isReadOnlyCommand("cat '/etc/shadow'", '/project')` returns `false`
- [ ] Unit test: `isReadOnlyCommand('cat ./README.md', '/project')` still returns `true`
- [ ] Unit test: `isReadOnlyCommand('cat "README.md"', '/project')` returns `true` (quoted relative path inside root)
- [ ] Existing `bash.ts` tests still pass

---

### 21.2 — Root Wipe Check Misses Subdirectories

**File:** `packages/core/src/tools/bash.ts`  
**Function:** `isRootWipe()` (line 87–108)  
**Severity:** HIGH — allows `rm -rf /usr`, `rm -rf /etc`

**The bug:**
```typescript
// bash.ts:107 — CURRENT (BROKEN)
return /(^|\s)(\/(\s|$|\*)|~|\$HOME|\$\{HOME\})/.test(rest);
```
This only matches bare `/`, `/*`, `~`, `$HOME`. It does NOT match `rm -rf /usr`, `rm -rf /etc`, `rm -rf /dev`, `rm -rf /var`, etc.

**Fix instructions:**
Replace the final return with a broader check:

```typescript
function isRootWipe(rawSegment: string): boolean {
  const segment = rawSegment.replace(/["'`]/g, " ").replace(/\$\(|\)/g, " ");
  const m = segment.match(/\brm\b(.*)$/);
  if (!m) return false;
  const rest = m[1];
  const shortFlags = [...rest.matchAll(/(^|\s)-([a-zA-Z]+)/g)].map((x) => x[2]).join("");
  const longFlags = [...rest.matchAll(/--([a-z-]+)/g)].map((x) => x[1]);
  const recursive =
    shortFlags.includes("r") || shortFlags.includes("R") ||
    longFlags.some((f) => f.startsWith("recursive"));
  const force = shortFlags.includes("f") || longFlags.some((f) => f.startsWith("force"));
  if (!(recursive && force)) return false;

  // Block: bare root (/), root glob (/*), home (~, $HOME), AND any top-level
  // system directory. A project-local `rm -rf ./build` stays allowed.
  const SYSTEM_PATHS = /(?:^|\s)(?:\/(?:\s|$|\*)|~|\$HOME|\$\{HOME\}|\/(?:usr|etc|var|dev|boot|lib|lib64|bin|sbin|opt|proc|sys|run|srv|tmp|root|mnt|media)(?:\s|\/|$))/;
  return SYSTEM_PATHS.test(rest);
}
```

**Acceptance criteria:**
- [ ] `isBlockedCommand('rm -rf /usr')` returns a non-null reason
- [ ] `isBlockedCommand('rm -rf /etc')` returns a non-null reason
- [ ] `isBlockedCommand('rm -rf /dev')` returns a non-null reason
- [ ] `isBlockedCommand('rm -rf /')` still blocked (regression check)
- [ ] `isBlockedCommand('rm -rf ~')` still blocked (regression check)
- [ ] `isBlockedCommand('rm -rf ./build')` returns `null` (project-local allowed)
- [ ] `isBlockedCommand('rm -rf ./dist')` returns `null`
- [ ] Existing `bash.ts` tests still pass

---

### 21.3 — Flag Injection in `verify_tests` Pattern

**File:** `packages/core/src/tools/verifyTests.ts`  
**Function:** `argvWithPattern()` (line 79–97)  
**Severity:** MEDIUM — AI-controlled pattern could inject runner flags

**The bug:**
If the AI provides a pattern starting with `--` (e.g., `--pastebin` for pytest), it's interpreted as a flag:
```typescript
case "pytest": return ["pytest", ...rest, pattern];
```

**Fix instructions:**
Add pattern sanitization at the top of `argvWithPattern`:

```typescript
function argvWithPattern(baseCommand: string, pattern: string): string[] | null {
  // Reject patterns that look like flags (would be interpreted by the runner)
  if (pattern.startsWith("-")) return null;
  // Reject null bytes
  if (pattern.includes("\0")) return null;
  
  const words = baseCommand.trim().split(/\s+/).filter(Boolean);
  // ... rest unchanged
}
```

**Acceptance criteria:**
- [ ] `argvWithPattern("pytest", "--pastebin")` returns `null`
- [ ] `argvWithPattern("cargo test", "-j1")` returns `null`
- [ ] `argvWithPattern("pytest", "test_login")` still works
- [ ] `argvWithPattern("npm test", "my-pattern")` still works
- [ ] Existing `verifyTests.test.ts` tests still pass

---

### 21.4 — Phase 21 Verification Gate

After all 3 fixes, run:

```bash
npm run build          # must exit 0
npm run typecheck      # must exit 0 (zero type errors)
npm test               # must pass all existing + new tests
npm run eval -- --fast --mock   # 15/15 pass
npm run certify -- --mock --all # 10/10 pass
```

**Deliverables:**
- [ ] All fixes committed with message: `fix(security): phase 21 — sandbox hardening (v0.9.0)`
- [ ] `docs/PHASE-21-PROGRESS.md` written (following existing format)
- [ ] `CHANGELOG.md` updated: `## [0.9.0]` section with `### Security` entries
- [ ] `CORE_VERSION` bumped to `"0.9.0"` in `packages/core/src/version.ts`
- [ ] All 4 workspace `package.json` version fields bumped to `0.9.0`

---

## 3. Phase 22 — Bug Fix Sweep (v0.9.1)

> **Priority:** HIGH — Correctness fixes  
> **Scope:** 12 logic bugs causing silent failures, crashes, or incorrect behavior  
> **Files touched:** `session.ts`, `gemini.ts`, `freeModels.ts`, `goalEngine.ts`, `readFile.ts`, `config/index.ts`, `openai.ts`, `checkpointStore.ts`, `awareness.ts`, `TuiPermissionBroker.ts`  
> **Estimated effort:** 6–10 hours  
> **No new features. Only bug fixes.**

### 22.1 — Cancellation Signal Lost Before First `send()`

**File:** `packages/core/src/agent/session.ts`  
**Lines:** 65, 150–152, 382–383

**The bug:** If `session.cancel()` is called before `send()` has been invoked, `currentController` is `null`, so `cancel()` is a no-op. The cancellation is silently dropped.

**Fix:**
```typescript
// Add new field:
private pendingCancel = false;

// Update cancel():
cancel(): void {
  if (this.currentController) {
    this.currentController.abort();
  } else {
    this.pendingCancel = true;
  }
}

// At the top of send(), after creating the controller:
const controller = new AbortController();
this.currentController = controller;
if (this.pendingCancel) {
  this.pendingCancel = false;
  controller.abort();
}
```

**Acceptance criteria:**
- [ ] Test: calling `cancel()` before `send()` causes `send()` to yield `{ type: "cancelled" }` immediately
- [ ] Test: calling `cancel()` during `send()` still works as before
- [ ] Existing `cancelHistory.test.ts` still passes

---

### 22.2 — Malformed Tool Call JSON Silently Passes Empty `{}`

**File:** `packages/core/src/agent/session.ts`  
**Lines:** 497–504

**The bug:**
```typescript
try { input = JSON.parse(raw); }
catch { input = {}; }  // tools receive empty input, model never knows
```

**Fix:**
```typescript
try {
  input = JSON.parse(raw);
} catch (parseErr) {
  // Tell the model its JSON was malformed so it can retry
  input = { __parseError: true, rawInput: raw.slice(0, 200) };
}
```

Then in the orchestrator or tool execution path, check for `__parseError` and return an `isError` result:

```typescript
// In orchestrator.ts or wherever executeTool is called:
if (input && typeof input === 'object' && '__parseError' in input) {
  return {
    output: { error: `Malformed JSON in tool call input. Raw: ${(input as any).rawInput}` },
    isError: true,
    summary: `${call.name}: malformed JSON input`,
  };
}
```

**Acceptance criteria:**
- [ ] Test: malformed tool call JSON yields `isError: true` with a message about malformed JSON
- [ ] Test: valid tool call JSON still works unchanged
- [ ] The model receives error feedback enabling it to retry with correct JSON

---

### 22.3 — Gemini `unknown_tool` Crash on Truncated History

**File:** `packages/core/src/providers/gemini.ts`  
**Line:** 149

**The bug:**
```typescript
const name = callNames.get(c.result.toolCallId) ?? "unknown_tool";
```
After compaction removes older messages, `callNames` can't find the original tool call. Gemini API rejects `"unknown_tool"` with a validation error.

**Fix:**
Skip orphaned tool results instead of sending a fake name:

```typescript
const name = callNames.get(c.result.toolCallId);
if (!name) {
  // Orphaned tool result — the originating tool_call was compacted away.
  // Skip rather than crash Gemini with "unknown_tool".
  continue;
}
```

**Acceptance criteria:**
- [ ] Test: Gemini message conversion with a tool_result whose tool_call was compacted does NOT include `"unknown_tool"`
- [ ] Test: Normal tool_call/tool_result pairs still convert correctly
- [ ] Existing Gemini-related tests still pass

---

### 22.4 — Free Model Pricing Check Is Fragile

**File:** `packages/core/src/providers/freeModels.ts`  
**Lines:** 57–58

**The bug:**
```typescript
String(m.pricing?.prompt ?? "") === "0"  // fails for "0.0", "0.00", 0
```

**Fix:**
```typescript
const promptPrice = Number(m.pricing?.prompt);
const completionPrice = Number(m.pricing?.completion);
const isZeroPrice = (promptPrice === 0 || isNaN(promptPrice))
  && (completionPrice === 0 || isNaN(completionPrice))
  && m.pricing != null;  // must actually have pricing data
```

**Acceptance criteria:**
- [ ] Test: pricing `"0"` → classified as free
- [ ] Test: pricing `"0.0"` → classified as free
- [ ] Test: pricing `0` (number) → classified as free
- [ ] Test: pricing `"0.001"` → classified as paid
- [ ] Test: pricing `undefined` → uses `:free` id check fallback

---

### 22.5 — Goal Engine Review Verdict Parsing Too Strict

**File:** `packages/core/src/agent/goal/goalEngine.ts`  
**Lines:** 271–272

**The bug:**
```typescript
const satisfied = /^YES\s*(?:—|--|:)/i.test(reviewVerdict)
  || reviewVerdict.toUpperCase() === "YES";
```
Fails on: `"YES."`, `"YES\n- looks good"`, `"YES, all criteria met"`.

**Fix:**
```typescript
// Accept any response starting with YES followed by a word boundary.
// Reject hedges like "Yes, but..." that indicate failure.
const startsYes = /^YES\b/i.test(reviewVerdict);
const isHedge = /^YES\s*[,]\s*(but|however|although|except|unfortunately)/i.test(reviewVerdict);
const satisfied = startsYes && !isHedge;
```

**Acceptance criteria:**
- [ ] `"YES"` → satisfied
- [ ] `"YES — criteria met"` → satisfied
- [ ] `"YES."` → satisfied
- [ ] `"YES\n- all good"` → satisfied
- [ ] `"NO — criteria not met"` → not satisfied
- [ ] `"YES, but the criteria were not met"` → not satisfied (hedge)
- [ ] Existing `goalEngine.test.ts` still passes

---

### 22.6 — `read_file` Has No Binary Detection

**File:** `packages/core/src/tools/readFile.ts`  
**Line:** 53

**The bug:** Binary files (`.png`, `.wasm`, `.o`) are read as UTF-8 and dump corrupted replacement characters into the context window (up to 512KB of garbage tokens).

**Fix:** After reading the buffer, check for null bytes:

```typescript
// After: buf = bytesRead === toRead ? content : content.subarray(0, bytesRead);
// Before: const text = buf.toString("utf8");

// Binary detection: check first 8KB for null bytes
const checkLen = Math.min(buf.length, 8192);
if (buf.subarray(0, checkLen).includes(0)) {
  return {
    output: { path: relPath, totalBytes, error: "Binary file detected — cannot display as text." },
    isError: true,
    summary: `read_file: ${relPath} is a binary file (${totalBytes} bytes)`,
  };
}
```

Note: the `finally { await fh.close(); }` block will still run, so this is safe.

**Acceptance criteria:**
- [ ] Test: reading a file with null bytes returns `isError: true` with "binary file" message
- [ ] Test: reading a normal text file still works
- [ ] Test: reading an empty file still works

---

### 22.7 — Ollama Blocked by Strict API Key Check

**File:** `packages/core/src/config/index.ts`  
**Lines:** 127–131

**The bug:** The `configured` filter requires `ApiKey.length > 0` for all providers, including keyless `ollama`.

**Fix:**
```typescript
const KEYLESS_PROVIDERS = new Set<ProviderId>(["ollama"]);

const configured = PROVIDER_ORDER.filter(
  (id) =>
    KEYLESS_PROVIDERS.has(id) ||
    (typeof input.creds[`${id}ApiKey` as keyof ProviderCredentials] === "string" &&
      (input.creds[`${id}ApiKey` as keyof ProviderCredentials] as string).length > 0)
);
```

**Acceptance criteria:**
- [ ] Test: `resolveProviderSelection` with `--provider ollama` and no API key → succeeds
- [ ] Test: `resolveProviderSelection` with `--provider anthropic` and no API key → still throws

---

### 22.8 — Vision Blindly Forwarded to Non-Vision Providers

**File:** `packages/core/src/providers/openai.ts` (shared by Groq, Mistral, Cerebras, GitHub)

**The bug:** `ChatCompletionsStyleProvider` sends images to providers that don't support vision.

**Fix:** Add a `supportsVision` flag (default `true`) and override to `false` in Groq, Mistral, Cerebras:

```typescript
// In ChatCompletionsStyleProvider:
protected supportsVision = true;

// In image mapping section of toOpenAIMessages:
if (c.type === "image" && this.supportsVision) {
  // existing image mapping
} else if (c.type === "image") {
  parts.push({ type: "text", text: "[Image omitted — this provider does not support vision]" });
}
```

Then in non-vision providers:
```typescript
export class GroqProvider extends ChatCompletionsStyleProvider {
  protected supportsVision = false;
  // ...
}
```

**Acceptance criteria:**
- [ ] Test: image to Groq → no `image_url` in payload, includes omission note
- [ ] Test: image to OpenAI → `image_url` present as normal

---

### 22.9 — `checkpointStore` Silently Wipes History on Read Error

**File:** `packages/core/src/agent/checkpointStore.ts`, Line 104

**The bug:** `catch { return []; }` — any JSON parse error → user loses ALL checkpoint history.

**Fix:**
```typescript
catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[anvil] Warning: failed to load checkpoints for session ${sessionId}: ${msg}`);
  return [];
}
```

Also fix save path (line 64) similarly.

---

### 22.10 — Synchronous `readdirSync` in Async Path

**File:** `packages/core/src/agent/goal/awareness.ts`, Line 128

**Fix:** `topLevelEntries = await fs.promises.readdir(projectRoot);`

---

### 22.11 — TUI Permission Broker Subscribe Race

**File:** `packages/tui/src/permission/TuiPermissionBroker.ts`

**The bug:** `subscribe()` immediately calls the listener, triggering React state updates during render.

**Fix:** Defer with `queueMicrotask`:
```typescript
subscribe(listener: (req: PermissionRequest | null) => void): () => void {
  this.listeners.add(listener);
  queueMicrotask(() => listener(this.current));
  return () => this.listeners.delete(listener);
}
```

### 22.12 — Session Rename State Desynchronization

**File:** `packages/tui/src/commands/registry.ts`, Line 322

**The bug:**
In `/session rename <title>`, the handler executes `renameSession(session.id, title)`. This updates the session title in the JSON file on disk, but **never mutates `session.title = title` on the active in-memory `AgentSession` instance**. On the very next user turn, `session.toStoredSession()` auto-saves the stale in-memory title, silently overwriting the user's rename on disk.

**Fix:**
```typescript
sessionRename: (title: string) => {
  if (isBusy) {
    printSystemMessage("Cannot rename the session while a turn is in flight.");
    return;
  }
  renameSession(session.id, title);
  session.title = title; // synchronize in-memory title with disk
  printSystemMessage(`Session renamed to "${title}".`);
},
```

**Acceptance criteria:**
- [ ] `/session rename <title>` updates `session.title` in memory
- [ ] Subsequent auto-saves preserve the new title instead of reverting it

---

### 22.13 — Free Model Demotion on Empty API Response

**File:** `packages/core/src/providers/freeModels.ts`, Lines 566–577

**The bug:**
In `syncFreeModels()`, the returned models are grouped into `byProvider`. If the external API returns an empty array `[]` (e.g. temporary outage or models discontinued), `byProvider` is empty. The loop `for (const [pid, list] of byProvider)` runs 0 times, completely bypassing `mergeFreeModels(pid, [])`. As a result, models that have lost free-tier status are never demoted and remain marked `[FREE]` forever.

**Fix:**
Ensure that every provider registered for the source runs `mergeFreeModels(pid, [])` even when the returned array is empty:
```typescript
// Seed with all known providers for this source so empty responses still demote
for (const pid of src.registeredProviderIds ?? [src.id]) {
  if (!byProvider.has(pid)) byProvider.set(pid, []);
}
for (const [pid, list] of byProvider) {
  const change = mergeFreeModels(pid, list);
  result.newlyFree.push(...change.newlyFree);
  result.noLongerFree.push(...change.noLongerFree);
}
```

**Acceptance criteria:**
- [ ] An empty API response demotes previously free models to paid/unfree
- [ ] Stale free models do not persist indefinitely in the cache

---

### 22.14 — Tool Abort Swallowed in Orchestrator

**File:** `packages/core/src/agent/orchestrator.ts`, Lines 94–96 & 159–162

**The bug:**
When `signal.aborted` triggers during `executeTool()`, the catch block catches `AbortError`, formats it as `{ error: "Tool execution failed: This operation was aborted" }`, and yields `tool_finished` with `isError: true`. The UI displays a failed tool call before showing cancellation, and history records a failure rather than an abort.

**Fix:**
Explicitly check `signal.aborted` or `err.name === "AbortError"`:
```typescript
} catch (err: unknown) {
  if (signal.aborted || (err instanceof Error && err.name === "AbortError")) {
    // Let orchestrator.run() handle clean cancellation bail-out
    return;
  }
  const msg = err instanceof Error ? err.message : String(err);
  result = { output: { error: `Tool execution failed: ${msg}` }, isError: true, summary: `Error: ${msg}` };
}
```

**Acceptance criteria:**
- [ ] Aborting during tool execution yields `{ type: "cancelled" }` without emitting a spurious `tool_finished` error
- [ ] Cancellation is recorded cleanly in the run ledger as `aborted`

---

### 22.15 — Subagent Checkpoint Cleanup Guarantee (`try / finally`)

**File:** `packages/core/src/agent/subagent.ts`, Lines 138–144

**The bug:**
In `runSubAgentLive()`, the temporary file cleanup call `await saveCheckpointsAsync(sub.id, [])` is placed at the very end of the generator function. If the subagent run aborts early or throws an unhandled error, this line is never reached. This leaves orphaned `.json` snapshot files in `~/.anvil/checkpoints/` containing raw project bytes.

**Fix:**
Wrap subagent execution in a `try / finally` block:
```typescript
try {
  // run subagent loop...
} finally {
  // Guarantee orphan cleanup regardless of aborts or exceptions
  await saveCheckpointsAsync(sub.id, []);
}
```

**Acceptance criteria:**
- [ ] Aborting a running subagent cleans up `ANVIL_HOME/checkpoints/<sub.id>.json`
- [ ] Crashes inside subagents do not leave orphaned checkpoint files on disk

---

### 22.16 — Eval Runner Socket Stall Interruption

**File:** `packages/core/src/eval/runner.ts`, Lines 128–132

**The bug:**
In `runAllEvalTasks()`, the timeout check `if (abortController.signal.aborted)` is placed inside the body of `for await (const event of session.send())`. If a provider's TCP connection stalls completely without emitting any chunk, the stream generator never yields, the loop body never executes, and the timeout never interrupts the turn.

**Fix:**
Attach an abort event listener directly to trigger `session.cancel()` and race the stream:
```typescript
const timeoutHandle = setTimeout(() => {
  abortController.abort();
  session.cancel();
}, timeoutLimit);
```
Ensure `session.cancel()` breaks the provider's active network socket cleanly.

**Acceptance criteria:**
- [ ] Hung provider network socket times out cleanly at `timeoutLimit`
- [ ] Benchmark evaluations do not stall indefinitely in CI

---

### 22.17 — MCP Boot Notices Silently Dropped in TUI

**File:** `packages/tui/src/components/App.tsx`, Lines 70–115

**The bug:**
In `cli/src/index.tsx`, when `~/.anvil/mcp.json` contains a syntax error or misconfigured server, `connectAllMcpServers()` records notices (e.g. `"MCP (file): mcp.json is not valid JSON"`), which are passed to `<App mcp={{ notices }} />`. However, in `App.tsx`, `props.mcp.notices` is accepted as a prop but **never rendered or printed on startup**. The user sees zero MCP tools and receives zero explanation why their server failed to load.

**Fix:**
Add a mount effect in `App.tsx` that prints all boot notices to system messages:
```typescript
useEffect(() => {
  if (mcp?.notices && mcp.notices.length > 0) {
    for (const notice of mcp.notices) {
      printSystemMessage(`⚠ ${notice}`);
    }
  }
}, []);
```

**Acceptance criteria:**
- [ ] A malformed `mcp.json` file prints an explicit warning banner on TUI startup
- [ ] Users receive immediate feedback without needing to manually run `/mcp`

---

### 22.18 — Phase 22 Verification Gate

```bash
npm run build && npm run typecheck && npm test && npm run eval -- --fast --mock && npm run certify -- --mock --all
```

**Deliverables:**
- [ ] All fixes committed: `fix(core): phase 22 — bug fix sweep (v0.9.1)`
- [ ] `docs/PHASE-22-PROGRESS.md` written
- [ ] `CHANGELOG.md` updated: `## [0.9.1]` section with `### Fixed` entries
- [ ] Version bumped to `0.9.1`

---

## 4. Phase 23 — Stability & Performance (v0.10.0)

> **Priority:** MEDIUM — Stability and reliability  
> **Scope:** Silent error elimination, performance fixes, CI repair  
> **Estimated effort:** 8–12 hours

### 23.1 — Eliminate Silent `catch {}` Blocks

Replace all 12+ instances with logging or explicit comments:

| File | Line | Fix |
|------|------|-----|
| `config/index.ts` | 32 | Add comment: `// credentials missing on first run — expected` |
| `config/index.ts` | 43 | Add comment: `// settings missing — use defaults` |
| `checkpointStore.ts` | 64 | Add `console.error` warning |
| `checkpoints.ts` | 196 | Add `console.warn` for path resolution failure |
| `awareness.ts` | 61 | Add `console.warn` for malformed package.json |
| `cache.ts` | 41 | Add `console.warn` for cache save failure |
| `session.ts` | 441 | Add `console.warn` for compaction failure |
| `orchestrator.ts` | 112 | Add comment explaining intentional swallow |
| `bash.ts` | 242 | Add comment: `// ESRCH — child already exited; expected race` |

**Rule:** Every catch block must either log a warning OR have a comment explaining why swallowing is intentional.

**Acceptance criteria:**
- [ ] `grep -rn 'catch\s*{' packages/*/src/` returns zero uncommented instances
- [ ] All tests pass

---

### 23.2 — Fix Ledger O(n²) Array Allocation

**File:** `packages/core/src/agent/session.ts`, Function: `recordLedger()` (line 301–321)

**Fix:** Replace `this.ledger = capLedger([...this.ledger, entry])` with:
```typescript
this.ledger.push(entry);
if (this.ledger.length > 600) {
  this.ledger = capLedger(this.ledger);
}
```

---

### 23.3 — Fix Compaction O(n²) `isSplit` Check

**File:** `packages/core/src/agent/compaction.ts`, Lines 92–96

**Fix:** Pre-compute a Set of split indices instead of calling `intervals.some()` in a loop.

---

### 23.4 — Add `React.memo` to TUI Hot-Path Components

**Files:**
- `packages/tui/src/components/MessageView.tsx` — wrap export in `React.memo`
- `packages/tui/src/components/MessageList.tsx` — wrap list items in `React.memo`

Prevents entire message history re-rendering on every streaming chunk.

---

### 23.5 — Lower Word-Diff LCS Bailout Threshold

**File:** `packages/tui/src/diff/wordDiff.ts`

Lower from 50K to 10K operations, or switch to patience diff for large inputs.

---

### 23.6 — Fix CI Visual Regression Always-Passing

**File:** `.github/workflows/visual-regression.yml`

Ensure `visual:capture` writes to `__visual-current__/` and `visual:diff` compares against committed `__visual-baselines__/`, not against itself.

---

### 23.7 — Fix Release Workflow Partial Publish Risk

**File:** `.github/workflows/release.yml`

Use `npm pack` → verify tarball → publish pattern to avoid partially published state.

---

### 23.8 — Stream Delta Backpressure Buffer (60 FPS Token Throttle)

**File:** `packages/tui/src/hooks/useAgentController.ts`, Lines 178–180 & 315–330

**The bug:**
```typescript
// useAgentController.ts:179
const updateAssistant = (fn: (m: DisplayMessage) => DisplayMessage) => {
  setMessages((prev) => prev.map((m) => (m.id === assistantId ? fn(m) : m)));
};
```
Every incoming `text_delta` immediately executes `updateAssistant()`, calling `.map()` across all messages and triggering a full Ink/Yoga layout recalculation. High-throughput models (Groq, Cerebras, Gemini Flash) at 100–200 tokens/sec choke the Node.js event loop with 200 renders/sec, dropping keystrokes (e.g. Esc to cancel) and causing terminal cursor freeze.

**Fix:**
Implement a batched token buffer in `useAgentController`:
```typescript
const textBufferRef = useRef("");
const flushTimerRef = useRef<NodeJS.Timeout | null>(null);

const flushTextBuffer = () => {
  if (!textBufferRef.current) return;
  const chunk = textBufferRef.current;
  textBufferRef.current = "";
  setMessages((prev) =>
    prev.map((m) => (m.id === assistantId ? { ...m, text: m.text + chunk } : m))
  );
};

// In the streaming loop:
if (event.type === "text_delta") {
  textBufferRef.current += event.text;
  if (!flushTimerRef.current) {
    flushTimerRef.current = setTimeout(() => {
      flushTimerRef.current = null;
      flushTextBuffer();
    }, 16); // 60 FPS throttle window
  }
} else {
  // Any non-text event (tool call, turn complete) immediately flushes pending text
  if (flushTimerRef.current) {
    clearTimeout(flushTimerRef.current);
    flushTimerRef.current = null;
  }
  flushTextBuffer();
  // process non-text event...
}
```

**Acceptance criteria:**
- [ ] 200 tokens/sec stream renders at ~60 FPS with zero dropped frames
- [ ] Keystrokes (Esc / Ctrl+C) respond immediately during high-speed streaming
- [ ] Tool call start/finish events immediately flush pending text without truncation

---

### 23.9 — Global Keyboard Focus Trap & Modal Scope Coordinator

**Files:** `packages/tui/src/components/App.tsx`, `packages/tui/src/hooks/useFocusScope.ts`

**The bug:**
In `App.tsx` (lines 285–340), modals like `DiffModal`, `PermissionPrompt`, and `ModelPicker` conditionally replace `<InputBar>` at the bottom of the screen because Ink's `useInput` hooks don't have focus isolation. Mounting both would cause keystrokes to bleed into the input bar while navigating the modal.

**Fix:**
Create a central Focus Scope Coordinator:
```typescript
export type FocusScope = "input" | "modal" | "mission";

export const FocusScopeContext = createContext<{
  scope: FocusScope;
  setScope: (s: FocusScope) => void;
}>({ scope: "input", setScope: () => {} });
```
Wrap all `useInput` calls in a scope guard:
```typescript
useInput((input, key) => {
  if (currentScope !== "modal") return; // ignore keystrokes when modal is not active
  // handle modal key...
});
```
This enables `<InputBar>` to stay mounted and styled properly, while modals render as **true floating centered dialog layers** in the middle of the screen.

**Acceptance criteria:**
- [ ] Modals render centered over the transcript without unmounting the main layout
- [ ] Keystrokes never bleed from a modal into the background input bar
- [ ] Esc cleanly closes modals and restores focus to `"input"`

---

### 23.10 — Alternate Screen Buffer (`smcup` / `rmcup`) & Anti-Flicker Architecture

**Files:** `packages/cli/src/index.tsx`, `packages/tui/src/components/App.tsx`

**The problem:**
Anvil renders inline into the normal terminal buffer. Long streaming turns, rapid diff expansions, and terminal resize events redraw from the top of the Ink bounding box, causing visible screen tearing, flickering, and leaving hundreds of messy lines in the user's bash scrollback history after exit.

**Fix:**
Enter the terminal's Alternate Screen Buffer on startup and restore cleanly on exit:
```typescript
// On boot (in cli/src/index.tsx or App.tsx):
process.stdout.write("\x1b[?1049h\x1b[H"); // smcup + home cursor

// On exit (SIGINT, SIGTERM, normal exit):
const cleanupScreen = () => {
  process.stdout.write("\x1b[?1049l"); // rmcup
};
process.on("exit", cleanupScreen);
```

**Acceptance criteria:**
- [ ] Running and exiting Anvil leaves zero dirty lines or leftover frames in the user's terminal
- [ ] Resizing the terminal window triggers crisp redraws with zero screen tearing

---

### 23.11 — XTerm SGR 1006 Mouse Protocol & Wheel Scrolling

**Files:** `packages/tui/src/hooks/useMouse.ts`, `packages/cli/src/index.tsx`

**The problem:**
The TUI is strictly keyboard-bound. In modern terminals (Ghostty, WezTerm, Kitty, iTerm2, Windows Terminal), developers expect to click buttons like `[ Allow ]`, `[ Deny ]`, switch tabs, and scroll through diffs or chat history using the mouse wheel.

**Fix:**
Enable XTerm SGR 1006 extended mouse tracking:
```typescript
// Enable mouse tracking:
process.stdout.write("\x1b[?1000h\x1b[?1002h\x1b[?1006h");

// Disable on exit:
process.stdout.write("\x1b[?1000l\x1b[?1002l\x1b[?1006l");
```
Implement a lightweight `useMouse()` hook to map mouse click coordinates to UI buttons (`[ Allow ]` / `[ Deny ]` / tab headers) and mouse wheel escape codes (`\x1b[<64;...` / `\x1b[<65;...`) to vertical transcript scroll.

**Acceptance criteria:**
- [ ] Clicking `[ Allow ]` or `[ Deny ]` triggers the corresponding permission action
- [ ] Mouse wheel up/down scrolls through transcript history and long diffs
- [ ] Mouse tracking disables cleanly on exit without leaving escape codes in the shell

---

### 23.12 — Native OS Desktop Notifications (OSC 777 / OSC 9) & Audio Bell

**Files:** `packages/core/src/agent/session.ts`, `packages/tui/src/util/notify.ts`

**The problem:**
Long-running turns (autonomous `/goal` missions, subagent delegations, or extensive test runs) leave the user waiting. If the user switches to a browser or IDE, they have no idea when Anvil pauses for a permission prompt or completes the mission.

**Fix:**
Emit terminal-native notification escape sequences when attention is required:
```typescript
export function notifyUser(title: string, message: string): void {
  // OSC 777 (modern standard for Kitty, Ghostty, WezTerm, iTerm2)
  process.stdout.write(`\x1b]777;notify;${title};${message}\x07`);
  // OSC 9 (Windows Terminal, ConEmu)
  process.stdout.write(`\x1b]9;${title}: ${message}\x07`);
  // Audio/Visual Terminal Bell
  process.stdout.write("\x07");
}
```

**Acceptance criteria:**
- [ ] Autonomous mission completion triggers a native desktop notification
- [ ] Mutating permission prompt triggers an alert when the terminal is in the background
- [ ] Notifications respect `settings.json` (`"notifications": false` disables them)

---

### 23.13 — Native OSC 52 System Clipboard Integration

**Files:** `packages/tui/src/util/clipboard.ts`, `packages/tui/src/components/DiffModal.tsx`

**The problem:**
Copying code blocks, test failure traces, or unified diffs out of a terminal app usually requires manual mouse drag selection (which grabs line numbers, borders, and margins). Furthermore, external clipboard tools (`xclip`, `pbcopy`) fail when running Anvil over SSH or inside Docker.

**Fix:**
Implement native ANSI OSC 52 clipboard escape sequence:
```typescript
export function copyToClipboardOSC52(text: string): void {
  const b64 = Buffer.from(text).toString("base64");
  process.stdout.write(`\x1b]52;c;${b64}\x07`);
}
```
Add keyboard shortcuts: `c` in DiffModal copies the current file's diff; `Ctrl+Y` copies the last assistant code block.

**Acceptance criteria:**
- [ ] Pressing `c` in DiffModal copies clean diff text directly to the OS clipboard
- [ ] Works seamlessly even over SSH and inside Docker/tmux sessions

---

### 23.14 — Truecolor Syntax Engine Upgrade (24-bit RGB Tokenizer)

**Files:** `packages/tui/src/markdown/renderMarkdown.ts`, `packages/tui/package.json`

**The problem:**
`cli-highlight` uses 16-color ANSI output that looks washed out and clashes with Anvil's theme colors. Code blocks lack proper token classification for modern languages (Rust, Go, TSX, Python 3.12).

**Fix:**
Upgrade the code block highlighter to a Truecolor 24-bit tokenizer synchronized with Anvil's 22-token theme:
- Supports Tokyo Night, Dracula, and One Dark palettes matching active theme (`dark`, `midnight`, `hacker`).
- Formats keywords, strings, types, and functions with distinct RGB colors instead of basic terminal ANSI.

**Acceptance criteria:**
- [ ] Code blocks render in crisp 24-bit Truecolor matching theme accents
- [ ] Supported languages (TypeScript, Python, Rust, Go, SQL, JSON, YAML, Bash) highlight correctly

---

### 23.15 — Focus Coordinator & Vim / Tab Multi-Pane Navigation

**Files:** `packages/tui/src/components/MissionDeck.tsx`, `packages/tui/src/components/App.tsx`

**The problem:**
In multi-column dashboards (e.g. Mission Control's Milestones, Active Output, Team Status), users get stranded with no clear keyboard-driven method to switch between columns.

**Fix:**
Implement Vim and Tab navigation:
- `Tab` / `Shift+Tab`: Cycle active pane focus (`milestones` ⇄ `output` ⇄ `team`).
- `Ctrl+W h` / `Ctrl+W l`: Jump left/right between panes.
- `j` / `k`: Scroll inside the currently focused pane.
- Active pane border highlights in `theme.colors.borderFocus`; inactive panes stay dim.

**Acceptance criteria:**
- [ ] Pressing Tab moves focus indicator to the next panel
- [ ] Vim pane keys (`Ctrl+W` + `h/l`) navigate columns seamlessly
- [ ] Scrolling keys only scroll the currently active pane

---

### 23.16 — Phase 23 Deliverables

- [ ] `docs/PHASE-23-PROGRESS.md`
- [ ] `CHANGELOG.md` updated: `## [0.10.0]`
- [ ] Version bumped to `0.10.0`

---

## 5. Phase 24 — Refinement & Tech Debt (v0.11.0)

> **Priority:** NORMAL — Code quality and resilience  
> **Scope:** Provider resilience, type safety, dead code removal, MCP improvements  
> **Estimated effort:** 12–16 hours

### 24.1 — Provider Stream Retry with Backoff

**File:** `packages/core/src/providers/base.ts`

Add `streamWithRetry` wrapper in `BaseProvider`:
```typescript
protected async streamWithRetry(request: CompletionRequest, maxRetries = 2): Promise<AsyncGenerator<StreamEvent>> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await this.doStream(request);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const isRetryable = /429|503|502|ECONNRESET|ETIMEDOUT/.test(lastError.message);
      if (!isRetryable || attempt === maxRetries) throw lastError;
      const delay = Math.min(1000 * 2 ** attempt, 10000);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastError!;
}
```

Then call `streamWithRetry` instead of `doStream` in `streamCompletion`.

**Acceptance criteria:**
- [ ] Transient 503 retries and succeeds
- [ ] Permanent 400 fails immediately
- [ ] 3 consecutive 503s fails after retries exhausted

---

### 24.2 — MCP Auto-Reconnection

**File:** `packages/core/src/mcp/client.ts`

Add health-check and reconnection on transport death:
```typescript
async callTool(serverId: string, toolName: string, args: unknown): Promise<unknown> {
  try {
    return await this.doCallTool(serverId, toolName, args);
  } catch (err) {
    if (this.isTransportDead(serverId)) {
      await this.reconnectServer(serverId);
      return await this.doCallTool(serverId, toolName, args);
    }
    throw err;
  }
}
```

---

### 24.3 — Remove Dead `BaseProvider` Methods

**File:** `packages/core/src/providers/base.ts`, Lines 31–42

Delete `toProviderTools()` and `toProviderMessages()` — never called by any subclass.

---

### 24.4 — Replace `as never` / `as any` with Proper Types

**Priority order:**
1. `gemini.ts` — replace 3 `as never` casts
2. `openai.ts` — replace 3 `as never` casts
3. `freeModels.ts` — replace `Array<any>` with `OpenRouterModel` interface
4. Test files — replace `as any` with proper mock typing

---

### 24.5 — Add Structured Logging

Create `packages/core/src/logger.ts`:
```typescript
export const log = {
  info: (msg: string) => process.stderr.write(`[anvil] ${msg}\n`),
  warn: (msg: string) => process.stderr.write(`[anvil] ⚠ ${msg}\n`),
  error: (msg: string) => process.stderr.write(`[anvil] ✗ ${msg}\n`),
  debug: (msg: string) => {
    if (process.env.ANVIL_DEBUG) process.stderr.write(`[anvil] 🔍 ${msg}\n`);
  },
};
```

Replace `console.log` in production code (not test files) with appropriate log levels.

---

### 24.6 — Credential File Permission Verification

**File:** `packages/core/src/config/index.ts`

After loading credentials, check file mode and warn if not 0600:
```typescript
const stat = fs.statSync(credPath);
const mode = stat.mode & 0o777;
if (mode !== 0o600) {
  console.warn(`[anvil] ⚠ ${credPath} has permissions ${mode.toString(8)} (expected 600)`);
}
```

---

### 24.7 — Standardized Provider Error Taxonomy

**File:** `packages/core/src/providers/types.ts`

**The problem:**
All provider stream errors are currently untyped raw string messages `{ type: "error", message: string }`. Calling code and circuit breakers have to use fragile regexes (`/429|rate limit|quota/i`, `/503|overloaded/i`) to determine if an error is a transient rate limit, authentication failure, context overflow, or fatal model 404.

**Fix:**
Introduce a structured error interface:
```typescript
export type ProviderErrorCode =
  | "RATE_LIMIT"
  | "AUTH_FAILED"
  | "MODEL_NOT_FOUND"
  | "CONTEXT_OVERFLOW"
  | "NETWORK_TIMEOUT"
  | "SERVER_OVERLOADED"
  | "INVALID_REQUEST"
  | "UNKNOWN";

export interface StreamEventError {
  type: "error";
  message: string;
  code?: ProviderErrorCode;
  httpStatus?: number;
  isRetryable?: boolean;
}
```
Update all 10 provider adapters to map vendor errors (Google, OpenAI, Anthropic, OpenRouter) to this shared taxonomy so callers can query `event.isRetryable` directly.

**Acceptance criteria:**
- [ ] All 10 provider adapters emit typed `code` and `isRetryable`
- [ ] Circuit breaker and backoff systems rely on `isRetryable` instead of regex string parsing

---

### 24.8 — Compaction Summarizer Quota Isolation

**File:** `packages/core/src/agent/compaction.ts`, Lines 102–130

**The problem:**
`compactIfNeeded()` executes an in-band summarization turn using the active provider and model. On rate-limited tiers (such as Gemini Free at 5 requests/min), generating a summary uses up a request immediately before the user's main turn runs, triggering unnecessary 429 quota exhaustion.

**Fix:**
1. Check rate-limit cooldown before triggering compaction.
2. Allow configuring a separate designated summarizer model (e.g. a local Ollama model or high-throughput Groq route) via `settings.json: { "compactionModel": "..." }`.
3. If summarizer hits a rate limit, gracefully skip compaction and allow the main turn to proceed.

**Acceptance criteria:**
- [ ] Compaction does not starve the active model of requests on low-RPM tiers
- [ ] Rate limits during compaction gracefully fall back without aborting the session

---

### 24.9 — Centralize Magic Numbers into Typed Configuration

**Files:** `packages/core/src/config/constants.ts`, `packages/core/src/config/types.ts`

**The problem:**
Over 20 magic numbers are hardcoded directly in tool and agent logic:
- `512 * 1024` (readFile max bytes)
- `20 * 1024` (bash max stream capture)
- `120_000` (bash timeout ms)
- `32_000` (fallback context window)
- `2` (max test auto-repairs)
- `8000` (subagent report max chars)
- `25` (max inner loop iterations)
- `0.75` (compaction threshold)
- `6` (compaction recent messages keep)
- `5` (checkpoint ring keep count)
- `30_000` (MCP request timeout ms)

**Fix:**
Centralize all constants into a typed `constants.ts` with optional environment variable overrides (`ANVIL_MAX_READ_BYTES`, `ANVIL_COMPACTION_THRESHOLD`, etc.) and user settings.

**Acceptance criteria:**
- [ ] Zero loose magic limits hardcoded in tool/session source files
- [ ] Constants can be overridden via `settings.json` or `ANVIL_*` env vars

---

### 24.10 — Error Formatting Consolidation (`getErrorMessage` Helper)

**Files:** `packages/core/src/util/errors.ts`, monorepo-wide

**The problem:**
The error formatting ternary `err instanceof Error ? err.message : String(err)` is copy-pasted over **45 times** across Core, TUI, and CLI catch blocks.

**Fix:**
Create a central utility in `packages/core/src/util/errors.ts`:
```typescript
export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && "message" in err && typeof (err as any).message === "string") {
    return (err as any).message;
  }
  return String(err);
}
```
Refactor all repetitive catch blocks to use `getErrorMessage(err)`.

**Acceptance criteria:**
- [ ] Zero raw `err instanceof Error ? ...` ternary duplications in production code
- [ ] Standardized, clean error strings across all error handlers

---

### 24.11 — Dead Export & Dead Code Purge

**Files:** `packages/core/src/providers/freeModels.ts`, `packages/core/src/providers/streaming.ts`, `packages/core/src/providers/base.ts`

**The problem:**
Unused dead symbols and methods remain exported from earlier prototype phases:
- `ORCAROUTER_KNOWN_FREE_IDS` (exported in `freeModels.ts:103`, never consumed).
- `AssembledCall` (exported in `streaming.ts:27`, never consumed).
- `toProviderTools()` and `toProviderMessages()` in `base.ts:31-42` (never called by any subclass).

**Fix:**
Purge all dead exports, unused types, and obsolete base class methods.

**Acceptance criteria:**
- [ ] Dead exports removed without breaking any consumer imports
- [ ] Monorepo build and typecheck pass cleanly

---

### 24.12 — Monolithic "Monster-File" Modularization

**Files:** `packages/core/src/agent/session.ts`, `packages/tui/src/hooks/useAgentController.ts`, `packages/tui/src/commands/registry.ts`

**The problem:**
As features accumulated across 20 phases, key files turned into unmaintainable mega-files:
- `session.ts:send()` spans **525 lines** in a single generator function.
- `useAgentController.ts` spans **781 lines** in a single React hook.
- `commands/registry.ts` spans **570 lines** holding 17+ slash command definitions inline.

**Fix:**
Modularize each mega-file:
1. **`session.ts`:** Extract closed-loop auto-verification logic into a modular hook `packages/core/src/agent/turnVerifier.ts`.
2. **`useAgentController.ts`:** Extract event reduction logic into `packages/tui/src/hooks/eventReducer.ts`.
3. **`commands/registry.ts`:** Split command handlers into individual modules under `packages/tui/src/commands/handlers/` (`model.ts`, `session.ts`, `diff.ts`, `mcp.ts`, etc.).

**Acceptance criteria:**
- [ ] `session.ts:send()` is reduced under 300 lines
- [ ] Slash command definitions are organized into separate files under `commands/handlers/`
- [ ] Full unit test suite passes with zero regressions

---

### 24.13 — Unified CLI Terminal Event Renderer

**Files:** `packages/cli/src/headless.ts`, `packages/cli/src/goalRunner.ts`, new `packages/cli/src/terminalRenderer.ts`

**The problem:**
Both `headless.ts` (lines 70–130) and `goalRunner.ts` (lines 50–110) hand-roll nearly identical 60-line `switch(event.type)` loops to format tool calls, verification runs, and errors for CLI stderr.

**Fix:**
Extract a shared `TerminalEventRenderer`:
```typescript
export function renderCliEvent(event: AgentEvent, opts?: { raw?: boolean }): void
```
Both `headless.ts` and `goalRunner.ts` delegate their event streams to this shared utility.

**Acceptance criteria:**
- [ ] CLI event formatting logic deduplicated into a single shared file
- [ ] Headless and goal mode output formatting remains identical and tested

---

### 24.14 — Close UX Item U11 (Rich MCP Tool Permission Prompts)

**Files:** `packages/core/src/mcp/client.ts`, `packages/tui/src/components/PermissionPrompt.tsx`

**The problem:**
Item **U11** is the only open UI debt item from Phase 10/15. When an external MCP tool requests permission, the prompt shows raw JSON text without parameter breakdown, human-readable summaries, or server origin badges.

**Fix:**
Implement rich MCP tool permission previews:
- Display the originating server name badge (e.g. `[mcp:sqlite] query`).
- Parse and format MCP parameters using the tool's JSON schema definitions.

**Acceptance criteria:**
- [ ] MCP tool permission prompts display clear parameter lists with server badges
- [ ] Closes open item U11 in `docs/ANVIL-COMPLETE-ROADMAP.md`

---

### 24.15 — Windows Portability Boundary & Detection

**Files:** `packages/core/src/tools/bash.ts`, `packages/core/src/tools/verifyTests.ts`

**The problem:**
`bash.ts` hardcodes `spawn("bash", ...)` and Unix process group signaling (`process.kill(-pid)`), which throws uncaught `EINVAL` exceptions on native Windows `cmd.exe` or PowerShell without WSL/Git Bash.

**Fix:**
Add runtime platform detection:
1. Detect `process.platform === "win32"`.
2. Check for the presence of `bash.exe` in `PATH` (e.g. Git Bash) or WSL.
3. If running inside an unsupported bare Windows shell, fail actionably with:
   `"Anvil requires a bash-compatible shell on Windows. Please run inside Git Bash or WSL (Windows Subsystem for Linux)."`

**Acceptance criteria:**
- [ ] Windows cmd.exe fails gracefully with actionable guidance instead of throwing unhandled `EINVAL`
- [ ] Windows Git Bash / WSL continues to work cleanly

---

### 24.16 — Eliminate Dummy Tool Stubs (`updatePlan.ts` & `delegateTask.ts`)

**Files:** `packages/core/src/tools/updatePlan.ts`, `packages/core/src/tools/delegateTask.ts`, `packages/core/src/agent/session.ts`

**The slop pattern:**
Previous AI agents created fake placeholder tools whose `execute()` functions are no-ops or dummy errors:
- `updatePlan.ts`: `execute()` literally returns `{ output: { ok: true }, isError: false, summary: "Plan recorded." }` without doing anything, because `session.ts:470` intercepts the tool by string name before the executor runs.
- `delegateTask.ts`: `execute()` returns an error `{ error: "delegate_task must be handled by the agent session." }` for the same reason.

**Fix:**
Provide execution contexts to tools instead of string interception in `session.ts`:
1. Allow tools to declare an execution handler that receives a session context object (`{ setPlan: (p: string) => void, runSubAgent: ... }`).
2. Move plan mutation and subagent dispatching cleanly into their respective tool files instead of cluttering `session.ts` with special-cased string checks.

**Acceptance criteria:**
- [ ] No dummy tool files returning hardcoded fake success strings
- [ ] `session.ts` does not contain hardcoded string matches for `update_plan` or `delegate_task`

---

### 24.17 — Phase 24 Deliverables

- [ ] `docs/PHASE-24-PROGRESS.md`
- [ ] `CHANGELOG.md` updated: `## [0.11.0]`
- [ ] Version bumped to `0.11.0`

---

## 6. Phase 25 — Next-Gen Evolution (v1.0.0)

> **Priority:** FUTURE — Only after Phases 21–24 are complete  
> **Scope:** Major new capabilities  
> **Estimated effort:** 40–80 hours (multiple sub-phases)

**IMPORTANT:** Each sub-phase should be treated as its own mini-project with a spec, implementation, tests, and verification gate. Do NOT attempt all at once.

### 25.1 — SSE/HTTP MCP Transport

**Current limitation:** MCP only supports stdio transport — no remote servers.

**Deliverables:**
- HTTP+SSE transport in `packages/core/src/mcp/transport.ts`
- Connection pooling, keepalive, and Bearer token authentication
- Timeout and retry with exponential backoff
- `mcp.json` schema extended: `"transport": "stdio" | "sse"`, `"url": "https://..."`
- Security: TLS verification, no plaintext credentials in logs
- `/mcp` status shows transport type per server

**Acceptance criteria:**
- [ ] Connect to a remote MCP server over SSE
- [ ] Tool calls work with request/response semantics
- [ ] Connection drops trigger auto-reconnection (from 24.2)
- [ ] All existing stdio MCP tests still pass

---

### 25.2 — Multi-Agent Collaboration (Agent Teams)

**Current limitation:** Sub-agents are fire-and-forget. No coordination, no shared context.

**Deliverables:**
- `AgentTeam` orchestrator in `packages/core/src/agent/team/`
- Parallel agent execution with shared filesystem, independent histories
- Inter-agent messaging (agent A references agent B's results)
- Strategies: `parallel`, `pipeline` (serial handoff), `review` (one works, one reviews)
- Budget allocation: split token/iteration budgets across agents
- `/team` slash command to inspect running agents
- `TUI TeamView` component

**Architecture:**
```
AgentTeam
├── Agent A (feature implementation)
├── Agent B (test writing)
└── Agent C (code review)
    └── Shared: projectRoot, baselineByPath, checkpoints
    └── Independent: history, provider stream, tool execution
```

---

### 25.3 — LSP Integration for Code Intelligence

**Current limitation:** `get_outline` uses regex. No type info, no go-to-definition.

**Deliverables:**
- LSP client in `packages/core/src/lsp/`
- Auto-detect and connect to language servers (TypeScript, Python, Rust, Go)
- New tools: `goto_definition`, `find_references`, `get_diagnostics`, `get_hover`
- `get_outline` upgraded to use LSP when available (falls back to regex)

---

### 25.4 — Plugin System

**Current limitation:** Adding tools requires modifying core source.

**Deliverables:**
- Plugin manifest: `~/.anvil/plugins/<name>/plugin.json`
- Plugins register: tools, slash commands, themes, system prompt additions
- Plugin tools sandboxed (same permission model as MCP)
- `/plugin` command: list, enable, disable, install
- Hot-reloadable via `/plugin reload`

---

### 25.5 — Intelligent Context Management

**Current limitation:** Compaction is simple summarize-and-replace.

**Deliverables:**
- Semantic message scoring by relevance to current task
- Selective compaction: summarize low-relevance, keep high-relevance verbatim
- File-aware context: recently edited files weighted higher
- `/context` command showing token budget breakdown
- Predictive compaction warning

---

### 25.6 — Native Guardian Engine & Built-In Anti-Slop System (`anvil gate` & Turn Interceptor)

> **Priority:** FUTURE FLAGSHIP CAPABILITY (Planned for Phase 25 v1.0.0)  
> **Prerequisite:** Baseline stabilization (Phases 21–24: Security, Logic Bugs, Stability, and Refactoring) must be 100% complete and verified before implementing native engine interceptors.

**The Vision:**
Transform Anvil from an AI coding assistant that relies on external verification scripts into the first AI coding assistant with an **active, built-in mechanical immune system against AI slop**.

**Deliverables:**
1. **`anvil init --guarded` (Instant Repo Provisioning):**
   - Automatically provisions language-tailored `AGENTS.md` and repository gates into any target project (TypeScript, Python, Rust, Go).
   - Generates `.fresh-allowlist.json` to inventory and drain existing legacy debt.
2. **Native Pre-Turn Slop Interceptor (Pre-Commit Immune System):**
   - Hook into Anvil's internal turn loop (`session.ts:send()`).
   - Intercept file diffs before presenting turns or writing to disk.
   - Automatically self-correct forbidden shortcuts (`as any`, empty catches, raw error formatting, hardcoded UI colors) before user review.
3. **Native CLI Command: `anvil gate`:**
   - Add first-class `anvil gate` subcommand directly to `@anvil/cli`.
   - Runs fast multi-stage verification (diff scanner, build, typecheck, tests, and eval benchmark) natively.
4. **Adaptive Ratchet & Codebase Health Telemetry:**
   - Tracks codebase freshness metrics, duplication score, and allowlist drain rate across sessions.

---

### 25.7 — v1.0.0 Release Criteria

- [ ] All Phase 21–24 fixes stable for ≥2 weeks
- [ ] At least one Phase 25 feature shipped and stable
- [ ] Eval pass rate ≥ 80% on real provider
- [ ] All 10 providers certified `live`
- [ ] Zero known security vulnerabilities
- [ ] All docs current

---

## 7. Standing Rules for All Agents

### 7.1 — Never Write Empty `catch {}` Blocks
Every catch must either log or explain why swallowing is intentional.

### 7.2 — Never Use `as any` or `as never`
Use proper type narrowing, generics, or `unknown` + type guards.

### 7.3 — Never Leave Placeholder Stubs
Throw `new Error("Not implemented: <reason>")` instead of returning generic errors.

### 7.4 — Always Run the Verification Gate
After EVERY change: `npm run build && npm run typecheck && npm test`

### 7.5 — Build Order Is Sacred
`core → tui → cli`. Never parallel. Never alphabetical.

### 7.6 — Record What You Verified
Write `PHASE-NN-PROGRESS.md` with file paths, tests added, gate output, known limitations.

### 7.7 — core Must Never Import from tui or cli
This boundary enables future frontends.

### 7.8 — Security Changes Get Dedicated Tests
Every fix must have a test that proves the attack vector is blocked.

---

## 8. Verification Gate (Run After Every Phase)

The sacred gate is now mechanically automated via a single command:

```bash
npm run gate
```

This single command executes the 5-step Guardian Gate:
1. **Slop & Boundary Scanner:** Scans git diff for empty `catch {}`, `as any` / `as never`, and package boundary leaks (`@anvil/core` importing TUI or CLI).
2. **Sequential Build Gate:** Verifies `@anvil/core` ➔ `@anvil/tui` ➔ `@anvil/cli` build order.
3. **Typecheck Gate:** Zero TypeScript errors across all 3 monorepo packages.
4. **Unit Test Gate:** All 494+ Vitest tests must pass.
5. **Eval Harness Gate:** 15/15 mock benchmark evaluation tasks must pass.

```bash
# Additional manual verification passes when modifying visual TUI or providers:
npm run visual                     # visual regression (11 scenarios)
npm run certify -- --mock --all    # 10/10 providers
```

**Rule:** If `npm run gate` fails, the agent is NOT done. The agent must fix the regression before finishing its turn.
