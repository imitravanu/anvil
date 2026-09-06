# PHASE 14 PROGRESS — Autonomous Goal Engine & Situational Awareness

> **Status:** COMPLETED & VERIFIED (2026-09-06)  
> **Author:** Chief Engineer  
> **Target:** Anvil v0.6.0  
> **Test Suite Status:** 374/374 passing across all 3 packages (`@anvil/core`, `@anvil/tui`, `@anvil/cli`). Zero regressions.

---

## 1. Executive Summary

Phase 14 delivers true **cognitive self-understanding and autonomous mission execution** for Anvil, transcending commodity LLM wrappers:
1. **Situational Awareness Subsystem (`packages/core/src/agent/goal/awareness.ts`):** Introspects workspace topology, git branch/dirty status, detected ecosystem (`node`, `rust`, `go`, `python`, `generic`), package manager, build/test scripts, and standing project rules (`AGENTS.md`, `.anvil/rules`, `.cursorrules`).
2. **Autonomous Goal Engine (`packages/core/src/agent/goal/goalEngine.ts`):** Decomposes high-level objectives into sequential milestones, drives tool actions autonomously across multi-step turns, performs closed-loop TDD verification, conducts adversarial self-critique, and synthesizes mission debriefings.
3. **CLI & TUI Integration:**
   - Headless CLI flag: `anvil -g, --goal "<objective>"` streams situational context, milestone progression, and final debriefing to standard streams.
   - Interactive TUI command: `/goal <objective>` kicks off autonomous multi-step execution with live progress reporting in the transcript.

---

## 2. Acceptance Criteria Verification Matrix

| ID | Requirement | Verification Artifact | Result |
|---|---|---|:---:|
| **G1** | `analyzeWorkspace()` accurately detects project ecosystem, git branch, and available scripts | `packages/core/src/agent/goal/__tests__/awareness.test.ts` (7 tests) | **PASSED** |
| **G2** | `GoalEngine` decomposes a goal into concrete milestones with verifiable criteria | `packages/core/src/agent/goal/__tests__/goalEngine.test.ts` (`parseMilestones`) | **PASSED** |
| **G3** | `GoalEngine` executes milestones sequentially, updating milestone status from pending to completed | `packages/core/src/agent/goal/__tests__/goalEngine.test.ts` (`GoalEngine.run`) | **PASSED** |
| **G4** | Bounded iteration guards (`MAX_GOAL_TURNS = 10`) protect execution from infinite looping | `packages/core/src/agent/goal/__tests__/goalEngine.test.ts` (`respects maxTurns bound`) | **PASSED** |
| **G5** | Adversarial critique phase audits final diff before debriefing | `packages/core/src/agent/goal/__tests__/goalEngine.test.ts` (`critique_started`, `critique_result`) | **PASSED** |
| **G6** | CLI & TUI integration: `--goal` flag and `/goal` slash command | `packages/cli/src/__tests__/goalRunner.test.ts` (2 tests), `packages/tui/src/commands/__tests__/registry.test.ts` (4 tests) | **PASSED** |

---

## 3. Files Created and Modified

### New Files:
- `packages/core/src/agent/goal/types.ts`: Domain models (`SituationalContext`, `GoalMilestone`, `GoalRunResult`, `GoalEvent`).
- `packages/core/src/agent/goal/awareness.ts`: Situational awareness and workspace introspection engine.
- `packages/core/src/agent/goal/goalEngine.ts`: Autonomous Goal Engine and milestone orchestrator.
- `packages/core/src/agent/goal/index.ts`: Goal subsystem export barrel.
- `packages/core/src/agent/goal/__tests__/awareness.test.ts`: 7 unit tests for situational awareness.
- `packages/core/src/agent/goal/__tests__/goalEngine.test.ts`: 4 unit tests for autonomous goal execution.
- `packages/cli/src/goalRunner.ts`: Headless goal mission executor.
- `packages/cli/src/__tests__/goalRunner.test.ts`: 2 unit tests for CLI headless goal execution.
- `packages/tui/src/commands/__tests__/registry.test.ts`: 4 unit tests for TUI `/goal` command dispatch.

### Modified Files:
- `packages/core/src/agent/index.ts`: Re-exported `./goal/index.js`.
- `packages/cli/src/headless.ts`: Exported `HeadlessPermissionBroker`.
- `packages/cli/src/index.tsx`: Added `-g, --goal <text>` flag and headless goal dispatch.
- `packages/tui/src/commands/types.ts`: Added `launchGoal` method to `CommandContext`.
- `packages/tui/src/commands/registry.ts`: Added `/goal` slash command and implementation.

---

## 4. Test Verification Baseline

- **`@anvil/core`**: 266 passed (43 test files)
- **`@anvil/cli`**: 8 passed (2 test files)
- **`@anvil/tui`**: 100 passed (22 test files)
- **Total:** 374 passed, 0 failed, 0 flaky.
- **Typecheck:** Clean across monorepo (`tsc -p . --noEmit` on core, tui, cli).
- **Bundle:** esbuild bundle generated cleanly.
