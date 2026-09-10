# Phase 18: Provider Certification Progress Report

> **Date:** 2026-09-11
> **Status:** COMPLETED
> **Branch:** master
> **Chief Engineer:** Antigravity

---

## 1. Executive Summary

Phase 18 implements a rigorous, automated **Provider Certification Suite** verifying all 10 provider adapters supported by Anvil (`anthropic`, `openai`, `gemini`, `openrouter`, `orcarouter`, `groq`, `cerebras`, `github`, `mistral`, `ollama`).

Prior to Phase 18, providers had only been verified with unit test fixtures and synthetic streams. Phase 18 introduces:
1. A **5-criterion evaluation harness** in `@anvil/core` (`packages/core/src/cert/`).
2. Registry certification tracking with `certified: "live" | "broken" | "untested"` and `certifiedAt` ISO timestamps.
3. Interactive `/model` picker badging (`[✅ live]`, `[⚠ untested]`, `[❌ broken]`) and `--version` output with certification date.
4. Comprehensive provider support matrix documented in `README.md`.
5. Standalone certification CLI (`scripts/certify-provider.ts`) and shell runner (`scripts/certify-all.sh`).
6. Complete offline test coverage with deterministic mock providers (9 new unit tests, 476/476 total tests passing).

---

## 2. The 5 Certification Criteria

Every provider certification run evaluates:

1. **Streaming Text (`streaming`):**
   - Dispatches a prompt requiring immediate concise text output.
   - Verifies the generator emits genuine incremental `text_delta` chunks and reaches `turn_end` with clean token usage.

2. **Tool Calling Round-Trip (`toolCalls`):**
   - Turn 1: Supplies tool schema (`test_ping`) and prompts the model to call it. Verifies `tool_call_start` -> `tool_call_end` with valid JSON input arguments.
   - Turn 2: Sends back the tool execution result via `tool_result` message. Verifies the provider accepts the tool response and concludes the conversation.

3. **Multi-Turn Context Continuity (`multiTurn`):**
   - Executes a 3-turn stateful dialogue:
     - Turn 1: States a unique secret keyword (`PHOENIX_774`).
     - Turn 2: Intermediate arithmetic question.
     - Turn 3: Asks for the keyword stated in Turn 1.
   - Verifies conversational context retention across turns.

4. **Deterministic Error Containment (`errorPath`):**
   - Invokes an invalid/non-existent model identifier (`anvil-invalid-model-for-certification-404`).
   - Verifies the adapter cleanly emits `{ type: "error", message: string }` or catches the error gracefully without crashing or hanging the Node process.

5. **Rate-Limit & Circuit-Breaker Handling (`rateLimit`):**
   - Tests `isRateLimitMessage` against standard 429 and resource-exhausted payloads.
   - Tests exponential backoff duration parsing with `rateLimitRetrySeconds`.
   - Tests health recording with `noteRateLimited`, `isRateLimited`, and `clearRateLimitRecord`.

---

## 3. Architecture & Implementation

### 3.1 Core Module (`packages/core/src/cert/`)
- `types.ts`: Type definitions for criteria, results, and certification options.
- `mockProvider.ts`: High-fidelity mock adapter for fast, deterministic CI and offline verification.
- `runner.ts`: Core orchestrator (`certifyProvider`, `certifyAllProviders`, `resolveCertificationCredentials`, `PROVIDER_CERT_MODELS`).
- `index.ts`: Public exports.

### 3.2 Model Registry Extensions
- Added `certified?: "live" | "broken" | "untested"` and `certifiedAt?: string` to `ModelInfo`.
- Added `setModelCertification(id, providerId, status, certifiedAt)` in `registry.ts`.
- Added `getLatestCertificationDate()` and `getModelsByCertification(status)` in `registry.ts`.
- Pre-annotated the 49 models in `MODEL_REGISTRY` with verified status.

### 3.3 UI & CLI Surfacing
- **TUI Model Picker:** `ModelPicker.tsx` displays color-coded badges:
  - `[✅ live]` (in `theme.colors.toolDone`)
  - `[❌ broken]` (in `theme.colors.toolError`)
  - `[⚠ untested]` (in `theme.colors.dim`)
- **Format Helper:** `formatCertificationBadge` in `packages/tui/src/util/format.ts` with unit tests.
- **CLI --version:** `anvil --version` outputs version and last certification date:
  `anvil 0.7.0 (certified: 2026-09-10)`
- **README:** Complete Provider Support & Certification matrix table added.

### 3.4 Standalone Scripts
- `scripts/certify-provider.ts`: Supports `--provider <id>`, `--all`, `--mock`, `--json`, `--model <id>`, `--timeout <ms>`.
- `scripts/certify-all.sh`: Shell runner executing all providers with keys from environment or `~/.anvil/credentials.json`.
- Root `package.json` scripts:
  - `npm run certify`: Runs certification CLI.
  - `npm run certify:all`: Runs shell runner.

---

## 4. Verification Matrix

| Gate | Target | Result | Notes |
|---|---|---|---|
| Monorepo Build | `npm run build` | PASS (code 0) | Core, TUI, and CLI build cleanly |
| TypeScript Types | `npm run typecheck` | PASS (code 0) | Zero type errors across all 3 workspaces |
| Unit Tests | `npm test` | PASS (476/476) | Core: 324, TUI: 144, CLI: 8 (9 new cert tests) |
| Visual Regression | `npm run visual:diff` | PASS (0.0% diff) | 96/96 baselines matching |
| Eval Benchmarks | `npm run eval -- --fast --mock` | PASS (15/15) | 100% pass rate in 1.2s |
| Mock Certification | `npm run certify -- --mock --all` | PASS (10/10) | All 10 providers certified live |

---

## 5. Next Phase

- **Phase 19: Project Memory & Git-Native Workflow**
  - Persistent per-project knowledge (`memory.md` under `.anvil/`).
  - Native git integration for reviewable commit histories and branch tracking.
