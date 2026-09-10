# Anvil — Complete Roadmap & Agent Build Guide

> **Version:** 0.7.0 (current) → 0.8.0 (target)
> **Last Updated:** 2026-09-10
> **Purpose:** This document is the **single source of truth** for all remaining Anvil development. It contains everything an agent needs to understand the project, what's been built, and what to build next — with full specifications, file lists, acceptance criteria, and sequencing constraints.

---

## Table of Contents

1. [Project Overview & Architecture](#1-project-overview--architecture)
2. [Current State (What's Done)](#2-current-state-whats-done)
3. [Sequencing Rule](#3-sequencing-rule)
4. [Phase 16 — v0.6.0 Hardening, Security & Release](#4-phase-16--v060-hardening-security--release)
5. [Phase 0 — Visual Regression Testing for TUI](#5-phase-0--visual-regression-testing-for-tui)
6. [Phase 17 — Verification Harness (Agent Evals)](#6-phase-17--verification-harness-agent-evals)
7. [Phase 18 — Provider Certification](#7-phase-18--provider-certification)
8. [Phase 19 — Project Memory & Git-Native Workflow](#8-phase-19--project-memory--git-native-workflow)
9. [Phase 20 — Distribution & CI Pipeline](#9-phase-20--distribution--ci-pipeline)
10. [Deliberately Deferred Features](#10-deliberately-deferred-features)
11. [Standing Gotchas for All Agents](#11-standing-gotchas-for-all-agents)
12. [Verification Gate (Run After Every Phase)](#12-verification-gate-run-after-every-phase)

---

## 1. Project Overview & Architecture

### What Is Anvil?

A **professional-grade, terminal-based AI coding agent** — comparable to OpenCode, Codex CLI, and Cline — with a polished Ink (React) TUI. Talk to a model, let it read, write, edit, and search your project, run shell commands, and watch every mutation through an interactive permission prompt with real unified diffs.

### Tech Stack

| Layer | Technology |
|---|---|
| Language | TypeScript, Node.js ≥ 20 |
| TUI | Ink 5 (React renderer for CLIs) |
| Syntax Highlighting | `cli-highlight` |
| Diffing | `diff` npm package |
| Package Manager | npm workspaces (monorepo) |
| Testing | Vitest |
| Bundler | esbuild (CLI bundle) |
| Visual Testing | pixelmatch + puppeteer-core |

### Monorepo Structure

```
anvil/
├── package.json                  # workspace root (v0.7.0)
├── tsconfig.base.json            # shared compiler options
├── packages/
│   ├── core/                     # Provider adapters, agent loop, tools, sessions, MCP, goal engine
│   │   └── src/
│   │       ├── agent/            # AgentSession, sub-agents, goal engine, turnState
│   │       │   ├── goal/         # awareness.ts, goalEngine.ts, types.ts
│   │       │   └── __tests__/
│   │       ├── config/           # credentials, settings, rules, MCP config
│   │       ├── mcp/              # MCP JSON-RPC client, transport, connections
│   │       ├── providers/        # 10 provider adapters + registry + free-model sync
│   │       ├── session/          # Session persistence (flat JSON files)
│   │       └── tools/            # 11 tools (read/write/edit/list/grep/bash/outline/verify/plan/delegate + MCP adapter)
│   ├── tui/                      # Ink components, hooks, commands, themes, visual tests
│   │   └── src/
│   │       ├── components/       # App, Header, MessageView, PermissionPrompt, ModelPicker, MissionDeck, DiffModal, RewindModal, VerificationCard, etc.
│   │       ├── commands/         # Slash command registry (17+ commands)
│   │       ├── hooks/            # useAgentController, useSessionCommands
│   │       ├── diff/             # ColorizedDiff with word-level highlighting
│   │       ├── markdown/         # Two-pass code block highlighter
│   │       ├── permission/       # TuiPermissionBroker
│   │       ├── theme/            # Theme system with custom user themes
│   │       ├── util/             # Labels, format, ledger, mcp status
│   │       ├── test-utils/       # ink-testing-library harness
│   │       └── __visual__/       # Visual regression test suite
│   └── cli/                      # Thin entry point: wires config + core + tui
│       └── src/
│           ├── index.tsx          # Main entry (async boot, MCP, headless/TUI routing)
│           ├── headless.ts        # Headless mode runner (-p flag)
│           └── goalRunner.ts      # Headless goal mode (--goal flag)
├── scripts/                      # (currently empty — visual scripts are in tui/scripts/)
├── docs/                         # 43 specification & record files
├── .github/workflows/            # CI (ci.yml) + Visual regression (visual-regression.yml)
└── README.md                     # Full user-facing documentation
```

### Key Architectural Rules

> [!IMPORTANT]
> 1. **`core` must NEVER import from `tui` or `cli`.** This boundary enables future web/desktop frontends.
> 2. **TUI/CLI compile against core's BUILT `dist/`**, not `src/`. After ANY core change: `npm run build -w @anvil/core` BEFORE `npm run typecheck`.
> 3. **Build order is dependency-ordered:** `core → tui → cli` (never parallel, never alphabetical).
> 4. **Provider adapters pass `ToolDefinition.inputSchema` straight through** — no adapter changes needed for new tool schemas.
> 5. **`ANVIL_HOME` is honored everywhere** — credentials, settings, sessions, models cache, MCP config.

### Provider Adapters (10 total)

| Provider | Adapter | Free Tier? |
|---|---|---|
| Anthropic | `anthropic.ts` | No |
| OpenAI | `openai.ts` | No |
| Google Gemini | `gemini.ts` | Yes (5 RPM) |
| OpenRouter | `openrouter.ts` | Yes (`:free` routes) |
| Groq | `groq.ts` | Yes |
| GitHub Models | `github.ts` | Yes |
| Cerebras | `cerebras.ts` | Yes |
| Mistral AI | `mistral.ts` | Yes (experimentation) |
| Ollama | `ollama.ts` | Yes (local) |
| Orcarouter | `orcarouter.ts` | Yes (free-only) |

### Tools (11 built-in)

| Tool | Mutating? | Description |
|---|---|---|
| `read_file` | No | Read file with line numbers (bounded at 512KB) |
| `write_file` | Yes | Write file with diff preview |
| `edit_file` | Yes | Search-and-replace with unified diff |
| `list_files` | No | Glob/name search (excludes node_modules/.git/dist) |
| `grep` | No | Regex line search across files |
| `run_command` | Yes | Shell command with output cap (~20KB), 2min timeout |
| `get_outline` | No | Structural symbol outline (functions, classes, interfaces) |
| `verify_tests` | No* | Run project test suite with pattern filter |
| `update_plan` | No | Record agent's current plan (shown to user) |
| `delegate_task` | No | Spawn a sub-agent for isolated research |
| `mcp_*` | Varies | External MCP server tools (namespaced) |

*`verify_tests` is `mutating: false` but has a shell injection fix pending in Phase 16.

---

## 2. Current State (What's Done)

### Completed Phases

| Phase | Name | Version | Tests |
|---|---|---|---|
| 0 (original) | Foundation & Scaffolding | 0.1.0 | — |
| 1 | Provider Abstraction Layer | 0.1.0 | Unit tests per adapter |
| 2 | Agent Loop & Tool System | 0.2.0 | FakeProvider + tool tests |
| 3 | TUI Shell | 0.3.0 | Manual + streaming tests |
| 4 | Permissions, Commands, Picker | 0.3.0 | switchModel, permission tests |
| 5 | Sessions & Compaction | 0.4.0 | store, compaction, resume tests |
| 6 | Polish & Distribution | 0.4.0 | Config, theming, npm pack |
| 7 | Free & Local Models | 0.5.0 | 5 new providers + registry |
| 8 | Truthful Engine + Free-Model Radar | 0.5.0 | 116/116 core (A1-A7, B1-B6) |
| 8.5 | UI Quick Wins (U1-U4) | 0.5.0 | PlanLine, NO_COLOR tests |
| 9 | Sub-Agent Delegation | 0.5.0 | 130/130 core (P9-1 to P9-7) |
| 10 | MCP External Tools | 0.5.1 | 157/157 core (M1-M8) |
| 11 | Project Rules & Workspace Outline | 0.6.0 | Rules + outline tests |
| 12 | Headless Automation | 0.6.0 | H1-H6 |
| 13 | Auto-Verification & Self-Repair | 0.6.0 | 288/288 total (V1-V7) |
| 14 | Goal Engine & Situational Awareness | 0.6.0 | 374/374 total (G1-G6) |
| 15 | Cockpit UI | 0.6.0 | 382/382 total (UI-1 to UI-5) |
| UI U5-U13 | Mid/Long-term UI items | 0.5.x | All DONE except U11 |
| Hardening | Safety + truthfulness slice | 0.5.1 | ANVIL_HOME, guard, ledger |
| Refinement | Robustness + stability | 0.7.0 | Bounded read, timeouts, compaction fallback |
| Phase 0 (new) | Visual Regression Matrix | 0.7.0 | 48 baselines (8×3×2) |

### Current Test Baseline

```
@anvil/core:  290+ tests across 45+ files
@anvil/tui:   100+ tests across 23+ files
@anvil/cli:   8+ tests across 2+ files
Visual:       48 baseline frames (8 scenarios × 3 sizes × 2 themes)
Total:        ~400 unit tests + 48 visual baselines
```

### Current Version: **0.7.0**

### What Remains Open

| Item | Status | Phase |
|---|---|---|
| Phase 17 Verification Harness | DONE (15 benchmark tasks + runner + CI gate) | Phase 17 |
| Phase 18 Provider Certification | DONE (5-criteria cert harness + registry status + CLI/UI surfacing) | Phase 18 |
| Phase 19 Project Memory & Git Workflow | DONE (.anvil/memory.md + update_memory + auto-commit + /diff + /pr) | Phase 19 |
| U11 MCP Tool UX | Open (permission prompts for external tools) | With Phase 10 maturity |
| Phase 20 Distribution & CI Pipeline | PROPOSED | After Phase 19 |


---

## 3. Sequencing Rule

```
Phase 16 → Phase 0 (visual regression) → Phase 17 → Phase 18 → Phase 19 → Phase 20
```

> [!IMPORTANT]
> **Phase 16 ships first** (it fixes a critical security hole).
> **Phase 0 before Phase 17** — Phase 0 locks TUI rendering so the eval harness (17) measures agent quality, not UI flakiness.
> **Phase 17 before everything else** — it converts later phases from "we think it works" into "it measurably works."

---

## 4. Phase 16 — v0.6.0 Hardening, Security & Release
 
> **Status:** COMPLETED & SHIPPED (in v0.6.0–v0.6.3)
> **Priority:** RESOLVED
> **Target:** Anvil v0.6.0
> **Spec:** [PHASE-16-SPEC.md](file:///home/mitravanu/Projects/anvil/docs/PHASE-16-SPEC.md)
> **Audit Record:** [AUDIT-2026-09-06.md](file:///home/mitravanu/Projects/anvil/docs/AUDIT-2026-09-06.md)

### 4.1 Objective

The Phase 11-15 wave was hardened, closed, and shipped. All 7 audit findings were resolved, tested, and released across v0.6.0–v0.6.3:

### 4.2 Fix List (7 items, in execution order)

#### 16.1 🔴 CRITICAL — `verify_tests` Shell Injection (SEC)

**Problem:** `runTestVerification` builds `${baseCommand} -- ${pattern}` and executes via `spawn("bash", ["-c", fullCommand])`. `pattern` is **model-controlled** and the tool is `mutating: false`, so arbitrary shell (e.g. `x; touch /tmp/canary`) executes with **no permission prompt**. Proven exploitable during audit.

**File:** `packages/core/src/tools/verifyTests.ts`

**Fix — stop going through a shell:**
1. Detect the test runner, then spawn as an **argv array** with pattern as a separate argument:
   - npm → `spawn("npm", ["test", "--", pattern])`
   - cargo → `spawn("cargo", ["test", pattern])`
   - pytest → `spawn("python", ["-m", "pytest", pattern])`
   - go → `spawn("go", ["test", "-run", pattern, "./..."])`
2. `detectTestCommand` becomes `detectTestRunner(projectRoot): { argv: string[]; label: string } | null`
3. Session-level auto-verify path (`session.ts`) uses the same argv form
4. `autoVerify` as an explicit command string (string form) keeps its meaning but is split on shell words with **no** `shell:` spawn option
5. Sanitize pattern: reject `null` bytes; no other filtering needed once no shell is involved
6. `stdio: ["ignore", "pipe", "pipe"]` — child's stdin must not stay open (interactive runners hang)
7. Env: pass `HOME` and `PATH` (npm needs `HOME`); add `NO_COLOR=1` and `CI=1`
8. Portability: resolve runner binary via `process.platform` (`npm.cmd` on win32)

**Acceptance:** Unit test proves `pattern: "x; touch <canary>"` results in a failed test run (pattern treated as literal), **no** canary file created. Extend existing `verifyTests.test.ts` for all four runners.

#### 16.2 Goal-Engine Honesty

**File:** `packages/core/src/agent/goal/goalEngine.ts`

**Problems found (all reproduced live):**
- Milestones marked `completed` unconditionally
- Trivial goal fell back to generic 3-phase plan
- Adversarial critique printed an empty verdict

**Fix (5 sub-items):**
1. **Evidence-gated completion:** Milestone is `completed` only if turn ended without error AND (when mutations occurred) verification passed. Otherwise → `"failed"` with summary. Add `"failed"` to `GoalMilestone.status`.
2. **Per-milestone critique:** Run adversarial critique after verification per milestone. Failed critique verdict flips milestone to `failed`. **Failed milestones do NOT abort the run** — continue to next, report in HUD/debrief. `GoalRunResult.success` requires ALL milestones genuinely completed.
3. **Non-empty critique:** If critique turn yields no text, re-ask once; if still empty, emit deterministic verdict from turn/error ledger.
4. **Decomposition quality:** Strengthen planning prompt (`"respond with ONLY a JSON array, no prose"`). On fallback, scale milestones to goal (single-artifact goal gets 1 milestone, not 3 phases).
5. **Fail-fast on permissions:** If no `-y` and first mutating tool is refused in goal mode, abort with `goal_failed: "Goal mode requires --yes"` instead of burning all 10 turns.

**Acceptance:** Unit tests for evidence-gating (verify-fail → `failed`), empty-critique recovery, scaled fallback. MissionDeck renders `[✗]` for failed milestones.

#### 16.3 Surface Verification Events Outside TUI

**Files:** `packages/cli/src/headless.ts`, `packages/cli/src/goalRunner.ts`

**Problem:** Both silently drop `verification_started` / `verification_result`.

**Fix:** Handle both events — stderr lines:
```
🧪 [verify] running npm test…
🧪 [verify] PASS (12s)
🧪 [verify] FAIL (exit 1)
```
`--raw` suppresses these.

**Acceptance:** Live headless run against a failing suite shows the verification lines.

#### 16.4 Cockpit Header Unborn-HEAD Fix

**File:** `packages/core/src/agent/goal/awareness.ts`

**Problem:** `git rev-parse --abbrev-ref HEAD` fails on a repo with zero commits → Header shows "no-git" for a real repo.

**Fix:** Check `git rev-parse --is-inside-work-tree` first; for branch use `git branch --show-current` (falls back to `HEAD (unborn)`).

**Acceptance:** Unit test + live frame for repo with zero commits.

#### 16.5 Session Robustness Nits

**Files:** `packages/core/src/agent/session.ts`, `packages/core/src/providers/freeModels.ts`

Three sub-fixes:
1. `mutationsOccurred`: only set when outcome exists and is not an error (missing outcomes after cancelled batch must not count)
2. Circuit-breaker accounting: one 429 must count as **one** failure (currently double-counts via `noteRateLimited` + `recordFailure`). `clearRateLimitRecord` must not be called on an open circuit. Non-rate-limit transport errors must NOT open the circuit.
3. Expose circuit state on the rate-limit notice so TUI can say "provider cooling down" instead of bare retry countdown.

#### 16.6 CHANGELOG Voice + Records Discipline

- Rewrite Unreleased "Added" entries in plain Keep-a-Changelog style
- Append an **Audit Record** (`docs/AUDIT-2026-09-06.md`) capturing what was live-verified

#### 16.7 Live Verification of Never-Run Flows

Scratch `ANVIL_HOME` + tmux recipe:
- `/diff` DiffModal (word-diff, multi-file nav)
- `/rewind` RewindModal (timeline + Enter rollback)
- MissionDeck during a real `/goal`
- Header <80-col collapse
- Failing-test VerificationCard in the TUI

> [!TIP]
> Gemini free tier is 5 req/min — space calls or use auto-retry.

### 4.3 Execution Order

```
16.1 (security) → 16.2 (goal honesty) → 16.3-16.5 (small fixes) →
full test + typecheck + build → 16.6 (changelog/records) → 16.7 (live pass) →
release per standard process (CHANGELOG dated, bump version.ts + pins, build,
npm pack -w packages/cli, global install, tag)
```

### 4.4 Non-Goals

No eval harness, provider certification, memory, or distribution work — that is Phases 17-20. No new features.

---

## 5. Phase 0 — Visual Regression Testing for TUI
 
> **Status:** COMPLETED (v0.7.0 + 96 baselines) — prerequisite for Phase 17 fulfilled
> **Priority:** 🟢 GREEN
> **Spec:** [PHASE-0-VISUAL-REGRESSION-SPEC.md](file:///home/mitravanu/Projects/anvil/docs/PHASE-0-VISUAL-REGRESSION-SPEC.md)

### 5.1 Objective

Automate visual regression detection with a deterministic PTY capture engine, pixelmatch diff gate, and comprehensive matrix. Successfully expanded to 96 baselines (8 scenarios × 6 sizes × 2 themes) and gated in CI.

> [!NOTE]
> Much of this infrastructure already exists in v0.7.0 (`visual:capture`, `visual:diff`, `visual:approve` scripts + 48 baselines + CI workflow). This phase **hardens and expands** that foundation.

### 5.2 What to Build

#### 5.2.1 Expanded Scenario Coverage

Current: 8 scenarios × 3 sizes × 2 themes = 48 baselines.
Target: 8 scenarios × **6** terminal sizes × 2 themes = **96 baselines**.

Add 3 new terminal sizes:
- 100×30 (common laptop)
- 160×50 (large external monitor)
- 40×20 (minimum viable — tests graceful degradation)

#### 5.2.2 Determinism Hardening

| Area | Fix |
|---|---|
| Timestamps | Mock `Date.now()` to fixed epoch |
| Spinner frames | Pin to first frame (no animation in capture) |
| ANSI cursor position | Flush all pending renders before capture |
| Model names | Use deterministic mock server responses |

#### 5.2.3 CI Workflow Enhancement

**File:** `.github/workflows/visual-regression.yml`

Ensure:
- Runs on every PR
- Uploads diff PNGs as artifacts on failure
- Exit code 1 on any pixel diff > 0.1%
- Matrix strategy: `ubuntu-latest` only (cross-OS deferred)

#### 5.2.4 Baseline Approval Workflow

`npm run visual:approve` must:
1. Copy `__visual-current__/` → `__visual-baselines__/`
2. Stage all changed files for git commit
3. Print summary of changed scenarios

### 5.3 Acceptance Criteria

| ID | Requirement | Verification |
|---|---|---|
| VR1 | `npm run visual:capture` produces deterministic PNG frames for 8 scenarios | SHA256 stability across 3 consecutive runs |
| VR2 | `npm run visual:diff` compares current vs committed baselines | Exit 0 = no diff; non-zero = pixel diff > 0.1% |
| VR3 | CI runs visual diff on every PR; fails on regression | GitHub Actions workflow |
| VR4 | `npm run visual:approve` promotes current → baseline | Single-command bump |
| VR5 | 6 terminal sizes × 2 themes per scenario | 96 baseline frames total |

### 5.4 Files to Create/Modify

```
packages/tui/
├── scripts/
│   ├── visual-capture.mjs      # Expand to 6 sizes
│   ├── visual-diff.mjs         # Tighten threshold
│   └── visual-approve.mjs      # Add git staging
├── __visual-baselines__/       # Expand to 6 size dirs × 2 themes = 12 dirs
│   ├── dark-40x20/             # NEW
│   ├── dark-80x24/
│   ├── dark-100x30/            # NEW
│   ├── dark-120x40/
│   ├── dark-160x50/            # NEW
│   ├── dark-200x60/
│   ├── highContrast-40x20/     # NEW
│   ├── highContrast-80x24/
│   ├── highContrast-100x30/    # NEW
│   ├── highContrast-120x40/
│   ├── highContrast-160x50/    # NEW
│   └── highContrast-200x60/
└── vitest.visual.config.ts     # Separate vitest config for visual tests
```

### 5.5 Dependencies

Already in `@anvil/tui` devDependencies:
```json
{
  "pixelmatch": "^7.2.0",
  "pngjs": "^7.0.0",
  "ansi-to-html": "^0.7.2",
  "puppeteer-core": "^25.10.0"
}
```

---

## 6. Phase 17 — Verification Harness (Agent Evals)

> **Status:** COMPLETED & VERIFIED (v0.8.0 prep)
> **Priority:** 🟢 GREEN
> **Progress Record:** [PHASE-17-PROGRESS.md](file:///home/mitravanu/Projects/anvil/docs/PHASE-17-PROGRESS.md)

### 6.1 Objective

Today "it works" means unit tests pass. Nothing measures whether the **agent** actually completes real tasks. This phase builds a **reproducible evaluation harness** that scores Anvil's agent loop against concrete programming tasks.

### 6.2 What to Build

#### 6.2.1 Fixture Repository

Create a dedicated fixture repository (or a directory within the monorepo) containing **15-30 reproducible tasks**:

| Category | Example Tasks |
|---|---|
| Bug Fix | Fix a failing test in a Node.js project |
| Feature | Implement a small function from a spec in a Python project |
| Migration | Replace a deprecated API call across 3 files |
| Regression | Find and fix a regression introduced by a diff |
| Multi-file | Refactor a class split across 2 files |
| Config | Add a new build script to package.json |

Each task is a directory containing:
```
tasks/
├── fix-failing-test/
│   ├── task.json          # { "name": "...", "prompt": "...", "timeout": 120, "maxTokens": 50000 }
│   ├── setup/             # Initial state (copied into a temp dir before each run)
│   │   ├── src/
│   │   └── package.json
│   ├── assertions/        # Verification scripts
│   │   ├── check.sh       # Exit 0 = pass, 1 = fail
│   │   └── expected/      # Expected file contents or diffs
│   └── README.md          # Human-readable task description
```

#### 6.2.2 Eval Runner

**File:** `packages/core/src/eval/runner.ts` (or a separate `packages/eval/` package)

```typescript
export interface EvalTask {
  name: string;
  prompt: string;
  setupDir: string;        // copied to temp before run
  assertionScript: string; // path to check.sh
  timeoutMs: number;       // per-task wall-clock cap
  maxTokens?: number;      // budget cap
}

export interface EvalResult {
  task: string;
  passed: boolean;
  wallClockMs: number;
  tokensUsed: { input: number; output: number };
  toolCalls: number;
  error?: string;          // if crashed or timed out
}

export interface EvalReport {
  date: string;
  model: string;
  provider: string;
  results: EvalResult[];
  passRate: number;        // 0-1
  totalWallClockMs: number;
  totalTokens: { input: number; output: number };
}
```

**Runner mechanics:**
1. For each task: copy `setup/` to a temp directory
2. Run `anvil -p "<prompt>" -y --raw` against the temp dir (uses Phase 12 headless mode)
3. After completion (or timeout), run `assertions/check.sh` in the temp dir
4. Record pass/fail + metrics
5. Aggregate into `EvalReport`

#### 6.2.3 Storage & Trends

- Results stored under `ANVIL_HOME/evals/<date>/report.json`
- `npm run eval` locally runs all tasks
- `npm run eval:report` prints a comparison table across recent runs

#### 6.2.4 CI Gate

- Every change to **prompts, tools, the goal engine, or compaction** runs the eval harness
- A regression (pass rate drops) blocks the release
- Subset of fast tasks (<30s each) run on every PR; full suite nightly

### 6.3 Acceptance Criteria

| ID | Requirement |
|---|---|
| E1 | At least 15 reproducible tasks exist with setup dirs and assertion scripts |
| E2 | `npm run eval` runs all tasks headlessly and produces a JSON report |
| E3 | Each task produces a deterministic pass/fail (no LLM-based judgment) |
| E4 | Report includes per-task wall-clock, token spend, and tool call count |
| E5 | Trend comparison: `npm run eval:report` compares current vs previous run |
| E6 | CI integration: PR gate on fast subset; full suite on schedule |
| E7 | All existing tests still pass |

### 6.4 Design Decisions

| Decision | Rationale |
|---|---|
| File/state assertions, NOT LLM judgment | Deterministic, reproducible, no flakiness from scoring model |
| Uses headless mode (`-p` + `--raw`) | Leverages Phase 12; no TUI in eval loop |
| Temp dir per task | Isolation; tasks can't interfere |
| Wall-clock + token caps | Prevents runaway costs during eval |
| Stored under `ANVIL_HOME/evals/` | Consistent with existing data dirs |

### 6.5 Non-Goals

- NO end-to-end TUI testing (that's Phase 0's visual regression)
- NO model-as-judge scoring
- NO multi-agent eval tasks (deferred until multi-agent is itself mature)
- NO provider-specific evals (that's Phase 18)

---

## 7. Phase 18 — Provider Certification
 
> **Status:** COMPLETED (see `docs/PHASE-18-PROGRESS.md`)
> **Priority:** RESOLVED
> **Prerequisite:** Phase 17 (eval harness)


### 7.1 Objective

The 10 provider adapters have been unit-tested only with `FakeProvider` and fixture stream chunks. This phase runs **one scripted live pass per provider** to certify real-world behavior.

### 7.2 What to Build

#### 7.2.1 Certification Script

**File:** `scripts/certify-provider.ts`

For each provider, test:
1. **Streaming text:** Send a simple prompt, verify `text_delta` events stream in
2. **Tool calls:** Send a prompt that triggers a tool call, verify `tool_call_start` → `tool_call_end` → `tool_result` round-trip
3. **Multi-turn context:** Send 3 turns, verify the model references earlier context
4. **Error path (deterministic 404):** Send an invalid model ID, verify a clean `error` event (not a crash)
5. **Rate-limit handling:** If the provider has known rate limits (Gemini 5RPM), verify the circuit-breaker and retry behavior

#### 7.2.2 Model Registry Certification Field

```typescript
// providers/registry.ts
export interface ModelInfo {
  // ...existing fields...
  certified: "live" | "broken" | "untested";  // NEW
  certifiedAt?: string;                        // ISO timestamp
}
```

#### 7.2.3 Surfacing

- `/model` picker shows certification status: ✅ live | ⚠ untested | ❌ broken
- README provider table includes certification column
- `--version` output includes last certification date

#### 7.2.4 Re-run Script

**File:** `scripts/certify-all.sh`

```bash
#!/bin/bash
# Run all provider certifications. Keys via env, never committed.
# Usage: ANTHROPIC_API_KEY=... OPENAI_API_KEY=... ./scripts/certify-all.sh
```

### 7.3 Acceptance Criteria

| ID | Requirement |
|---|---|
| C1 | Certification script exists for all 10 providers |
| C2 | Each script tests: streaming, tool calls, multi-turn, error path |
| C3 | Results recorded in model registry (`certified` field) |
| C4 | `/model` picker and README surface certification status |
| C5 | Re-run script checked into `scripts/` (keys via env) |
| C6 | All existing tests still pass |

### 7.4 Non-Goals

- NO automated re-certification in CI (requires API keys in CI secrets — defer)
- NO provider-specific bug fixes in this phase (only record status)
- NO new provider adapters

---

## 8. Phase 19 — Project Memory & Git-Native Workflow

> **Status:** COMPLETED (see [PHASE-19-PROGRESS.md](PHASE-19-PROGRESS.md))
> **Priority:** 🟢 MEDIUM
> **Prerequisite:** Phase 17 (eval harness scores memory's value)

### 8.1 Objective

Give Anvil persistent, per-project knowledge and native git integration so it remembers what was tried, where things live, and can produce reviewable commit histories.

### 8.2 What to Build

#### 8.2.1 Project Memory (`memory.md`)

**File:** `packages/core/src/config/memory.ts`

```typescript
export interface ProjectMemory {
  path: string;              // .anvil/memory.md
  content: string;
  sizeBytes: number;
}

export function loadProjectMemory(projectRoot: string): ProjectMemory | null;
export function appendToMemory(projectRoot: string, entry: string): void;
export function buildSystemPromptWithMemory(
  basePrompt: string,
  projectRoot: string,
  rules: ProjectRules | null,
  memory: ProjectMemory | null
): string;
```

**Behavior:**
- File: `.anvil/memory.md` in the project root (gitignored by default)
- Auto-creates `.anvil/.gitignore` containing `memory.md` if `.anvil/` dir is created
- Injected at session start, after project rules, with a size cap of **32KB** (`MAX_MEMORY_BYTES`)
- The agent can write to memory via a new `update_memory` tool:
  - Name: `update_memory`
  - Input: `{ entry: string }` — appended with a timestamp header
  - `mutating: false` (writes to `.anvil/memory.md`, not project code)
  - Description: "Record a note in the project memory for future sessions. Use for: what was tried, where things live, conventions discovered."

**System prompt injection order:**
```
<base system prompt>

[Project-specific rules from <source>]
<rules content>

[Project memory from .anvil/memory.md]
<memory content>
```

#### 8.2.2 Auto-Commit per Goal Milestone

**File:** `packages/core/src/agent/goal/goalEngine.ts` (extend)

- Opt-in setting: `settings.json` → `"autoCommit": true`
- On milestone completion (status `completed`):
  1. Stage all modified files: `git add -A`
  2. Commit with message format: `anvil(goal): milestone N — <title>`
  3. If commit fails (nothing staged, or git not available), log warning, continue
- The debrief maps to a reviewable git history

**New config field:**
```typescript
// config/types.ts
export interface AnvilSettings {
  // ...existing...
  autoCommit?: boolean;  // default false
}
```

#### 8.2.3 `/diff main` Review Mode + PR Creation

**New command:** `/diff <branch>` (extends existing `/diff`)

**Behavior:**
- `/diff` (no args): existing behavior — show files modified this session
- `/diff main` (or any branch name): show `git diff main...HEAD` in the DiffModal
- `/pr` (new command): if `gh` CLI is available, run `gh pr create --fill` and show the URL

**Files to modify:**
- `packages/tui/src/commands/registry.ts` — extend `/diff` to accept branch arg
- `packages/core/src/tools/` — add git helper utilities

### 8.3 Acceptance Criteria

| ID | Requirement |
|---|---|
| M1 | `.anvil/memory.md` loads at session start and is injected into system prompt |
| M2 | `update_memory` tool appends timestamped entries |
| M3 | Memory is capped at 32KB with truncation marker |
| M4 | `.anvil/.gitignore` auto-created to exclude `memory.md` |
| M5 | Auto-commit creates git commits per completed milestone (opt-in) |
| M6 | `/diff <branch>` shows cross-branch diff in DiffModal |
| M7 | `/pr` creates a PR via `gh` when available |
| M8 | All existing tests + eval harness still pass |

### 8.4 Non-Goals

- NO SQLite or database storage (stays flat files per roadmap principle)
- NO automatic memory summarization/compaction (manual for now)
- NO cross-project memory sharing

---

## 9. Phase 20 — Distribution & CI Pipeline

> **Status:** PROPOSED
> **Priority:** 🟢 MEDIUM
> **Prerequisite:** Phase 17-19 (eval harness, certification, memory)

### 9.1 Objective

Make Anvil installable by anyone with a single command, with a CI pipeline that catches regressions before they ship.

### 9.2 What to Build

#### 9.2.1 Real `npm publish`

**Files to update:**
- `packages/cli/package.json` — verify `bin`, `files`, `main`, `types`
- Root `package.json` — `prepublishOnly` script
- `packages/core/package.json` — `prepublishOnly` + proper `exports` field
- `packages/tui/package.json` — `prepublishOnly` + proper `exports` field

**Publish process:**
```bash
# 1. Bump version in all 4 package.json files + version.ts
# 2. Update CHANGELOG.md with release date
# 3. Build all packages
npm run build
# 4. Run all gates
npm run typecheck && npm test && npm run eval
# 5. Publish (core first, then tui, then cli)
npm publish -w @anvil/core
npm publish -w @anvil/tui
npm publish -w @anvil/cli
# 6. Tag
git tag v<version> && git push --tags
```

#### 9.2.2 CI Pipeline (Comprehensive)

**File:** `.github/workflows/ci.yml` (extend existing)

```yaml
on: [push, pull_request]
jobs:
  build-and-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: npm run build
      - run: npm run typecheck
      - run: npm test
      # Fast eval subset (tasks under 30s each)
      - run: npm run eval -- --fast
      # Visual regression
      - run: npm run visual:capture
      - run: npm run visual:diff
```

#### 9.2.3 Install Story

Beyond `npm i -g`:
- **Versioned release tags** on GitHub
- **SHA256 checksums** for tarballs
- **README quickstart** that matches the released binary exactly:
  ```bash
  npm install -g @anvil/cli
  cd ~/my-project
  anvil
  ```
- **npx support:** `npx @anvil/cli` for try-without-install

#### 9.2.4 Release Automation

**File:** `.github/workflows/release.yml`

```yaml
on:
  push:
    tags: ['v*']
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { registry-url: 'https://registry.npmjs.org' }
      - run: npm ci && npm run build
      - run: npm run typecheck && npm test
      - run: npm publish -w @anvil/core
      - run: npm publish -w @anvil/tui
      - run: npm publish -w @anvil/cli
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

### 9.3 Acceptance Criteria

| ID | Requirement |
|---|---|
| D1 | `npm publish` works for all 3 packages in dependency order |
| D2 | `npm install -g @anvil/cli` from a clean machine installs and runs |
| D3 | CI pipeline runs typecheck + tests + fast eval on every PR |
| D4 | Visual regression CI blocks merging on pixel drift |
| D5 | Release workflow publishes to npm on version tag |
| D6 | README quickstart accurately describes the install path |
| D7 | CHANGELOG is current and follows Keep-a-Changelog format |
| D8 | `npx @anvil/cli` works for zero-install trial |

---

## 10. Deliberately Deferred Features

> [!CAUTION]
> Do NOT build any of these until Phases 16-20 are complete. They are intentionally deferred.

| Feature | Why Deferred |
|---|---|
| **LSP integration** | Large surface area, marginal gain while `get_outline` + tools cover the need |
| **Agent teams / swarms** | Demo value over daily value; revisit after eval harness can score multi-agent quality |
| **Anvil as an MCP server** | Useful eventually; only worth building once Phases 17-20 land |
| **Remote MCP transports** (SSE/HTTP) | Credential management project of its own; local stdio covers the capability |
| **MCP sampling** (server→model callbacks) | Single-owner model loop; Phase 8 non-goal lineage |
| **Predictive token counting** | Only record measured usage for now; reactive compaction is sufficient |
| **Cross-OS visual regression** | Start with Ubuntu CI only |
| **Persistent "always allow" permissions** | Security risk; session-scoped by design |

---

## 11. Standing Gotchas for All Agents

> [!WARNING]
> Every agent working on this codebase MUST read these before making changes.

1. **TUI/CLI compile against core's BUILT `dist/`** (`dist/index.d.ts`), not `src/`. After ANY core change: `npm run build -w @anvil/core` BEFORE `npm run typecheck`, or tui/cli report phantom "no exported member" errors.

2. **Build order matters:** The root `npm run build` script is explicitly ordered `core → tui → cli`. Never use `--workspaces --if-present` for builds (alphabetical order breaks it).

3. **The history model has no "system" role** (`Role = "user" | "assistant"`). Budget/loop notices must be injected as user or assistant role messages, respecting each provider's turn-alternation rules.

4. **Gemini's `functionResponse` adjacency requirement:** You cannot insert a separate user message between an assistant `tool_call` and its user `tool_result`. Loop demand messages must be merged INTO the tool_result message.

5. **`providerMetadata` must round-trip untouched.** Gemini's `thoughtSignature` and similar opaque blobs are required for history replay. Never strip, modify, or default this field.

6. **The TUI build compiles tests into `dist/`** — vitest config (`packages/tui/vitest.config.ts`) restricts test discovery to `src/` only. If you add tests, ensure they're discovered from `src/`, not `dist/` copies.

7. **`ANVIL_HOME` paths are resolved lazily per call** (env may be set after import). Test relocation via env is safe.

8. **A source that returns an empty live list cannot drive demotions.** An empty free-model list from a provider is a source glitch, not "everything became paid." Demotion requires a non-empty list that omits the model.

9. **The Phase 8 ledger cap is 1000 entries** (drop oldest). Plan and ledger caps bound session-file growth.

10. **Sub-agent usage is intentionally NOT yielded as a `usage` event** — it would pollute the main-turn compaction estimate. Only the capped report (≤8000 chars) enters main history.

---

## 12. Verification Gate (Run After Every Phase)

```bash
cd /home/mitravanu/Projects/anvil

# 1. Build core first (tui/cli depend on its dist/)
npm run build -w @anvil/core

# 2. Strict typecheck across all packages
npm run typecheck

# 3. Full test suite
npm test -w @anvil/core
npm test -w @anvil/tui
npm test -w @anvil/cli    # if cli has tests

# 4. Full build (including esbuild bundle)
npm run build

# 5. Visual regression (if baselines exist)
npm run visual:diff

# 6. Check for unintended file changes
git status --porcelain
```

**All gates must be GREEN before a phase is considered complete.**

> [!IMPORTANT]
> A phase is NOT done until:
> 1. All acceptance criteria tests exist and pass
> 2. All existing tests still pass (zero regressions)
> 3. `git diff --stat` shows only files within the phase's scope
> 4. A PROGRESS.md record has been written (verified facts, not claims)
