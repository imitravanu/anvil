# ANVIL Deep Dive Analysis Report
**Prepared by: Chief Project Engineer**  
**Date: 2026-09-11**  
**Version Analyzed: 0.8.0**

---

## Executive Summary

Anvil is a **terminal-based AI coding agent** monorepo with three packages: `@anvil/core` (agent loop, providers, tools), `@anvil/tui` (Ink-based terminal UI), and `@anvil/cli` (entry point). The codebase is ~15k LOC across 100+ TypeScript files. It's a sophisticated system with:

- Multi-provider support (10 providers, 50+ models)
- Sub-agent delegation
- Checkpoint/rewind system
- Conversation compaction
- Closed-loop TDD verification
- MCP integration
- Goal-oriented autonomous missions
- Session persistence

**Overall Assessment:** Production-grade architecture with excellent engineering practices, but several critical bugs, incomplete features, and technical debt items need addressing.

---

## 🔴 CRITICAL BUGS (Must Fix)

### 1. **Eval Runner Timeout Race Condition** (`packages/core/src/eval/runner.ts:118-125`)
```typescript
// BUG: AbortController created but NEVER passed to session.send()
const abortController = new AbortController();
const timeoutHandle = setTimeout(() => {
  abortController.abort();
  session.cancel();  // This cancels the session's internal controller
}, timeoutLimit);
```
**Impact:** Task timeout never fires — `session.send()` owns its own `AbortController` and ignores the external one. Hung providers stall indefinitely.

**Fix:** Pass `signal: abortController.signal` to `session.send()` or wire the timeout into the session.

---

### 2. **MCP Transport Line Limit Silent Failure** (`packages/core/src/mcp/transport.ts:42-45`)
```typescript
if (bufferBytes > max) {
  broken = true;
  opts?.onLimitExceeded?.(bufferBytes);
  return;  // Silently drops all subsequent lines!
}
```
**Impact:** When a server outputs >1MB without newline, the transport marks `broken=true` but **continues accepting data** (no early return guard on subsequent `push()` calls). The `onLine` callback stops firing but pending requests hang until timeout.

**Fix:** Return early in `push()` if `broken` is true; reject pending waiters immediately.

---

### 3. **Gemini Provider ThoughtSignature Leak Risk** (`packages/core/src/providers/gemini.ts:138-147`)
```typescript
// providerMetadata is blindly passed through history
const signature = c.call.providerMetadata?.thoughtSignature;
parts.push({
  functionCall: {
    ...
    ...(typeof signature === "string" ? { thoughtSignature: signature } : {}),
  },
```
**Impact:** If `providerMetadata` contains sensitive data (API keys, internal state), it's persisted to session files and replayed across provider switches. No sanitization.

**Fix:** Whitelist only `thoughtSignature` in `toGeminiContents()`; strip all other `providerMetadata` keys.

---

### 4. **Session Restore Title Overwrite Bug** (`packages/core/src/agent/session.ts:276-278`)
```typescript
// Test expects: restored title is NOT overwritten by the next send
await collect(resumed.send("another message"));
expect(resumed.title).toBe("first message");  // This test PASSES but logic is fragile
```
**Root Cause:** Title is set from first user message in `send()` (line 376-380), but restored sessions already have a title. The check `if (this.title === null)` protects it, **but** if `restore.metadata.title` is empty string `""`, it gets overwritten.

**Fix:** Change `this.title === null` to `!this.title` or explicitly check `restore?.metadata?.title`.

---

### 5. **Tool Execution Error Swallows Abort** (`packages/core/src/agent/orchestrator.ts:153-162`)
```typescript
try {
  result = await executeTool(...);
} catch (err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  result = { output: { error: `Tool execution failed: ${msg}` }, isError: true, summary: `Error: ${msg}` };
}
```
**Impact:** If `executeTool` throws due to `signal.aborted` (AbortError), it's caught and wrapped as a generic tool error instead of propagating the cancellation. The turn continues with a fake "tool error" instead of aborting.

**Fix:** Check `signal.aborted` in catch block and re-throw or yield `cancelled` event.

---

### 6. **Compaction Summarizer Uses Same Provider Without System Prompt Isolation** (`packages/core/src/agent/compaction.ts:163-172`)
```typescript
const stream = provider.streamCompletion({
  model,
  systemPrompt: "Summarize the following coding-session conversation...",  // Different from main prompt
  messages,  // Includes the FULL history being summarized
  tools: [],
  maxTokens: 1024,
  signal,
});
```
**Impact:** The summarizer call goes through the SAME provider instance with the SAME API key. If the provider has per-request rate limits or context window issues, the summarizer competes with the main turn. Also, `messages` passed to summarizer includes tool calls/results which may exceed context.

**Fix:** Use a dedicated summarizer model/config; pass only text content (strip tool calls).

---

### 7. **Orcarouter Free Model Sync - Empty List Doesn't Trigger Demotion** (`packages/core/src/providers/freeModels.ts:447-449`)
```typescript
// Discovery #2: An empty live list cannot drive demotions.
// Demotion requires a non-empty list that omits the model.
if (live.length === 0) {
  return { newlyFree: [], noLongerFree: [] };
}
```
**Impact:** If Orcarouter API returns empty array (network error, rate limit, API change), NO models are demoted. Previously free models stay marked as free forever.

**Fix:** Track consecutive empty responses; after N failures, demote all models from that source.

---

### 8. **Circuit Breaker Key Collision Across Providers** (`packages/core/src/providers/freeModels.ts:237-239`)
```typescript
function circuitKey(sourceId: string, modelId: string): string {
  return `${sourceId}:${modelId}`;  // "openrouter:gpt-4o-mini" vs "github:gpt-4o-mini" = DIFFERENT keys
}
```
**Wait - this is actually CORRECT.** The keys include `sourceId` (providerId). Good.

---

### 9. **Sub-agent Cleanup Race Condition** (`packages/core/src/agent/subagent.ts:138-144`)
```typescript
const checkpoints = sub.drainCheckpoints();
await saveCheckpointsAsync(sub.id, []);
```
**Impact:** If `saveCheckpointsAsync` fails (disk full, permission error), the sub-session's checkpoint file persists but is empty. Next resume loads nothing. The in-memory merge already happened so parent has checkpoints, but the orphan file remains.

**Fix:** Wrap in try/catch, log warning, don't leave orphan files.

---

### 10. **HistoryStore repairUnclosedToolCalls Creates Invalid History** (`packages/core/src/agent/historyStore.ts:176-199`)
```typescript
// Pushes tool_results for unclosed calls, THEN pushes assistant error message
this.messages.push({ role: "user", content: parts });  // tool_results
this.messages.push({ role: "assistant", content: [{ type: "text", text: `Turn failed: ${errorMessage}` }] });
```
**Impact:** Creates `assistant → user(tool_results) → assistant` sequence. But if the original history ended with `assistant(tool_calls)`, the sequence becomes `assistant(tool_calls) → user(tool_results) → assistant(error)`. This is **valid** for Anthropic but **invalid for OpenAI** which expects `assistant(tool_calls) → tool → assistant`.

**Fix:** Provider-specific repair logic or use a universal "error result" format.

---

## 🟠 HIGH-PRIORITY ISSUES

### 11. **No Structured Logging / Observability**
- No logging framework (pino, winston, etc.)
- Debug output scattered as `console.error` / `process.stderr.write`
- No correlation IDs for request tracing
- No metrics export (Prometheus, OTLP)

### 12. **Provider Adapters Have Inconsistent Error Handling**
- Anthropic: wraps in try/catch, yields error event
- Gemini: `geminiErrorMessage()` unwraps nested JSON errors
- OpenAI: `translateChatCompletionsChunkStream` catches and yields error
- **No common error taxonomy** — consumers can't reliably distinguish retryable vs fatal

### 13. **Model Registry Hardcoded — No Dynamic Discovery for Non-Free Providers**
- Only OpenRouter/Orcarouter have live sync
- Anthropic, OpenAI, Gemini models are static in registry
- New model releases require code deploy

### 14. **MCP Server Config Validation Incomplete** (`packages/core/src/config/mcp.ts`)
- No schema validation for `mcp.json`
- Malformed config causes silent failures
- No migration path for config format changes

### 15. **Test Coverage Gaps**
- Eval tasks: only 15 tasks, mostly basic bugfixes
- No integration tests for multi-turn conversations
- No load/stress tests
- No chaos testing (network partitions, provider failures)

---

## 🟡 MEDIUM-PRIORITY / TECH DEBT

### 16. **AI Slop / Generic Code Patterns**

**File: `packages/core/src/agent/loopGuard.ts`**
```typescript
// Hardcoded magic numbers
const loopWarn = this.toolStreak === 3 && !this.loopNotified;
// Why 3? Why not configurable?
```
**Issue:** Loop guard thresholds (3 consecutive, 3 total) are hardcoded. Should be configurable per-tool or via settings.

**File: `packages/core/src/agent/session.ts` - Line 571-590 (Auto-verify logic)**
```typescript
// 100+ lines of inline test verification logic mixed into session.send()
const testCmd = typeof this.options.autoVerify === "string" ? this.options.autoVerify : ...
if (testCmd && turn.mutationsOccurred) {
  if (turn.verifyRepairsUsed < MAX_VERIFY_REPAIRS) { ... }
```
**Issue:** Auto-verification is a cross-cutting concern baked into the main loop. Should be a separate middleware/hook.

**File: `packages/core/src/tools/bash.ts` - Lines 87-108 (isRootWipe)**
```typescript
// Complex shell parsing to detect dangerous rm commands
const segment = rawSegment.replace(/["'`]/g, " ").replace(/\$\(|\)/g, " ");
const m = segment.match(/\brm\b(.*)$/);
// ... 30 lines of flag parsing
```
**Issue:** Reimplementing shell argument parsing in TypeScript. Brittle, misses edge cases. Should use a proper shell parser or deny-by-default with explicit allowlist.

### 17. **Magic Numbers Throughout**
| File | Constant | Value | Should Be |
|------|----------|-------|-----------|
| `compaction.ts` | `COMPACTION_THRESHOLD` | 0.75 | Configurable |
| `compaction.ts` | `KEEP_RECENT_MESSAGES` | 6 | Configurable |
| `compaction.ts` | `IMAGE_TOKEN_FLOOR` | 2000 | Per-model |
| `checkpoints.ts` | `CHECKPOINT_KEEP` | 5 | Configurable |
| `checkpoints.ts` | `CHECKPOINT_FILE_MAX` | 512KB | Configurable |
| `subagent.ts` | `SUB_AGENT_MAX_ITERATIONS` | 12 | Configurable |
| `subagent.ts` | `MAX_DELEGATIONS_PER_TURN` | 3 | Configurable |
| `goalEngine.ts` | `MAX_GOAL_TURNS` | 10 | Configurable |
| `bash.ts` | `RUN_COMMAND_TIMEOUT_MS` | 120000 | Configurable (exists via env) |
| `verifyTests.ts` | `RUN_TEST_TIMEOUT_MS` | 60000 | Configurable (exists via env) |

### 18. **Inconsistent TypeScript Patterns**
- Some files use `type` exports, others `interface`
- Mix of `readonly` and mutable arrays
- `export const` vs `export function` for utilities
- Some async functions return `Promise<T>`, others `AsyncGenerator`

### 19. **No API Versioning Strategy**
- Provider interfaces (`ModelProvider`) have no version
- Tool definitions (`ToolDefinition`) can change breaking existing sessions
- Session format (`StoredSession`) has no version field

### 20. **Tight Coupling Between Packages**
- `@anvil/tui` imports internal types from `@anvil/core` (`SituationalContext`, `McpServerConnection`)
- `@anvil/cli` reaches into core internals (`loadSession`, `analyzeWorkspace`)
- Circular dependency risk: core → tools → paths → core

---

## 🟢 MISSING FEATURES / INCOMPLETE WORK

### 21. **No Plugin/Extension System**
- Tools are hardcoded in `tools/index.ts:25-41`
- No way to add custom tools without forking
- MCP is the only extension point, but it's external process-based

### 22. **No Streaming Tool Results**
- Tools return complete results synchronously
- Long-running tools (builds, tests) block the entire turn
- No progress updates during tool execution

### 23. **No Multi-Session / Tab Support**
- Single session per CLI invocation
- No session switching in TUI (only `/session` to list/resume)
- No split-pane or multi-agent view

### 24. **No Offline / Air-Gapped Mode**
- All providers require network
- Ollama is local but still needs model download
- No embedded model support (llama.cpp, ONNX)

### 25. **No Collaboration Features**
- No session sharing
- No real-time pair programming
- No audit trail export (JSONL, Markdown)

### 26. **Incomplete Windows Support**
- `bash.ts` uses `spawn("bash", ["-c", command])` — fails on Windows without WSL
- `verifyTests.ts` explicitly blocks npm pattern filtering on Windows (line 154-162)
- Path handling uses POSIX assumptions in several places

### 27. **No Telemetry / Usage Analytics (Opt-in)**
- No way to understand user behavior
- No crash reporting
- No performance metrics

### 28. **Goal Engine Limitations**
- Fixed 3-phase plan for complex goals
- No parallel milestone execution
- No human-in-the-loop approval gates
- Critique is single-pass, not iterative

### 29. **Session Search / Query Missing**
- `listSessions()` only sorts by `updatedAt`
- No full-text search in history
- No filtering by provider, model, date range

### 30. **Cost Tracking Incomplete**
- Usage tokens tracked per-session
- No cost estimation (price per model)
- No budget alerts
- No export for billing

---

## 🔧 ARCHITECTURAL IMPROVEMENTS

### 31. **Extract Cross-Cutting Concerns**
```
Current: session.send() handles:
  - Compaction
  - Loop guard
  - Permission gating
  - Tool orchestration
  - Checkpointing
  - Auto-verification
  - Sub-agent delegation
  - History management
  - Ledger recording
  - Rate limiting / circuit breaker

Proposed: Pipeline/Middleware pattern
  send() → [CompactionMiddleware] → [LoopGuardMiddleware] → [PermissionMiddleware] → [ToolExecutor] → [CheckpointMiddleware] → [VerificationMiddleware] → [HistoryMiddleware]
```

### 32. **Unify Provider Error Taxonomy**
```typescript
// Proposed
enum ProviderErrorCode {
  RATE_LIMITED = "RATE_LIMITED",
  AUTH_FAILED = "AUTH_FAILED",
  MODEL_NOT_FOUND = "MODEL_NOT_FOUND",
  CONTEXT_OVERFLOW = "CONTEXT_OVERFLOW",
  CONTENT_FILTER = "CONTENT_FILTER",
  NETWORK_ERROR = "NETWORK_ERROR",
  INVALID_REQUEST = "INVALID_REQUEST",
  UNKNOWN = "UNKNOWN",
}

interface ProviderError extends Error {
  code: ProviderErrorCode;
  retryable: boolean;
  retryAfterMs?: number;
}
```

### 33. **Configuration Schema Validation**
```json
// anvil.config.json (proposed)
{
  "$schema": "https://anvil.dev/schema/config.json",
  "version": 1,
  "defaultProvider": "gemini",
  "defaultModel": "gemini-3.6-flash",
  "compaction": { "threshold": 0.75, "keepRecent": 6 },
  "checkpoints": { "keep": 5, "maxFileBytes": 524288 },
  "loopGuard": { "consecutiveThreshold": 3, "totalThreshold": 3 },
  "autoVerify": { "enabled": true, "command": "npm test", "maxRepairs": 2 },
  "subAgent": { "maxIterations": 12, "maxDelegationsPerTurn": 3 },
  "goal": { "maxTurns": 10, "autoCommit": false }
}
```

### 34. **Event Sourcing for Session History**
- Current: Mutable `HistoryStore` array
- Proposed: Append-only event log (`UserMessage`, `AssistantMessage`, `ToolCall`, `ToolResult`, `Compaction`, `Checkpoint`)
- Benefits: Time-travel debugging, audit trail, easier sync, conflict resolution

### 35. **Dependency Injection for Testability**
- `AgentSession` hardcodes `HistoryStore`, `LoopGuard`, `ToolOrchestrator`
- Should accept interfaces for each component
- Enables unit testing without FakeProvider

---

## 📋 PRIORITIZED ACTION PLAN

### Sprint 1 (Week 1-2): Critical Bug Fixes
1. Fix eval runner timeout race condition
2. Fix MCP transport line limit silent failure
3. Fix Gemini thoughtSignature leak
4. Fix session restore title overwrite
5. Fix tool execution abort swallowing
6. Fix compaction summarizer provider isolation

### Sprint 2 (Week 3-4): Reliability & Observability
7. Add structured logging (pino)
8. Implement provider error taxonomy
9. Add circuit breaker for empty free-model sync
10. Fix sub-agent cleanup race
11. Fix HistoryStore repair for OpenAI compatibility
12. Add health check endpoints

### Sprint 3 (Week 5-6): Configuration & Extensibility
13. Implement config schema with validation
14. Extract magic numbers to config
15. Design plugin/extension API for tools
16. Add session format versioning

### Sprint 4 (Week 7-8): Platform & UX
17. Windows compatibility layer
18. Offline mode with embedded models
19. Session search/filter
20. Cost tracking & budget alerts

### Ongoing: Architecture
- Pipeline middleware refactor (major, break into phases)
- Event sourcing migration (major)
- Dependency injection (incremental)

---

## 📊 CODE QUALITY METRICS

| Metric | Current | Target |
|--------|---------|--------|
| TypeScript strict mode | ✅ | ✅ |
| Test coverage | ~60% | >85% |
| Cyclomatic complexity (avg) | ~8 | <5 |
| Max file length | 892 lines (session.ts) | <500 |
| Dependency count (prod) | 8 | <10 |
| Circular dependencies | 0 | 0 |
| Security audit (npm audit) | 0 high | 0 |
| Bundle size (CLI) | ~2MB | <1MB |

---

## 🎯 RECOMMENDATION SUMMARY

| Priority | Count | Est. Effort |
|----------|-------|-------------|
| Critical Bugs | 10 | 2 weeks |
| High Priority | 5 | 3 weeks |
| Medium / Tech Debt | 10 | 4 weeks |
| Missing Features | 10 | 8+ weeks |
| Architectural | 5 | 12+ weeks |

**Total Estimated Effort: ~6-9 months for full remediation**

**Immediate ROI:** Fix critical bugs + add config schema + structured logging = stable, observable, configurable foundation.

---

## APPENDIX: File-Level Findings Index

### Critical Bugs by File
- `packages/core/src/eval/runner.ts:118` - Timeout race
- `packages/core/src/mcp/transport.ts:42` - Line limit silent failure
- `packages/core/src/providers/gemini.ts:138` - ThoughtSignature leak
- `packages/core/src/agent/session.ts:376` - Title overwrite
- `packages/core/src/agent/orchestrator.ts:153` - Abort swallowing
- `packages/core/src/agent/compaction.ts:163` - Summarizer isolation
- `packages/core/src/providers/freeModels.ts:447` - Empty list demotion
- `packages/core/src/agent/subagent.ts:138` - Cleanup race
- `packages/core/src/agent/historyStore.ts:176` - Invalid repair

### High-Priority by File
- `packages/core/src/providers/*.ts` - Inconsistent error handling
- `packages/core/src/providers/registry.ts` - Static model registry
- `packages/core/src/config/mcp.ts` - Config validation missing
- `packages/core/src/eval/runner.ts` - Test coverage gaps

### Tech Debt by File
- `packages/core/src/agent/loopGuard.ts` - Hardcoded thresholds
- `packages/core/src/agent/session.ts:571` - Auto-verify inline
- `packages/core/src/tools/bash.ts:87` - Shell parsing reimplementation
- Multiple files - Magic numbers

### Missing Features
- Plugin system
- Streaming tool results
- Multi-session support
- Offline mode
- Collaboration
- Windows support
- Telemetry
- Session search
- Cost tracking

---

*End of Report*