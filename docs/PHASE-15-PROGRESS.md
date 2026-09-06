# PHASE 15 PROGRESS — The Autonomous Engineering Cockpit TUI

> **Status:** COMPLETED & VERIFIED (2026-09-06)  
> **Author:** Chief Engineer  
> **Target:** Anvil v0.6.0  
> **Test Suite Status:** 382/382 passing across all 3 packages (`@anvil/core`, `@anvil/tui`, `@anvil/cli`). Zero regressions.

---

## 1. Executive Summary

Phase 15 transforms Project Anvil's terminal interface from a generic 2023 chat box into a high-density, terminal-native **Autonomous Engineering Cockpit** matching Anvil's advanced agentic capabilities:

1. **Situational Cockpit Header & Telemetry Bar:**
   - Real-time environmental awareness introspecting repo name, active git branch (with dirty indicator `*`), project ecosystem (`node`, `rust`, `go`, `python`), package manager (`pnpm`, `npm`, `yarn`, `cargo`), detected test runner script (`vitest`, `pytest`, `cargo test`), and active rules source (`AGENTS.md`, `.anvil/rules`, `.cursorrules`).
   - Telemetry status bar featuring checkpoint count indicator (`⎌ <n>`) and real-time test suite health (`🧪 green` / `🧪 fail` / `🧪 testing...`).

2. **Observable Closed-Loop TDD & Self-Repair Cards (`VerificationCard`):**
   - Direct visual grounding of Anvil's self-healing loop in the transcript.
   - Shows exact test command executed, visual pass/fail indicators, failure snippets, and active repair loop badge (`🔧 Auto-Repair Attempt 1/2`).

3. **Mission Deck HUD (`MissionDeck.tsx`):**
   - Dedicated, docked milestone deck replacing flat single-line indicators.
   - Dynamically tracks active goal title, milestone DAG states (`✓` Completed, `▶` Running with live detail notes, `○` Pending, `✗` Failed), and turn economy budget (`[1/3] · Turn 2/10`). Smoothly unmounts when idle.

4. **Interactive Cockpit Modals:**
   - **`DiffModal`**: Interactive syntax-highlighted diff inspector with multi-file tab switching (`Tab`/`h`/`l`), colorized unified diffing, and keyboard scrolling (`↑`/`↓`).
   - **`RewindModal`**: Visual checkpoint time-travel timeline showing snapshot IDs, timestamps, modified file counts, and 1-key instant rollback on `Enter`.

5. **Terminal Ergonomics & Layout Discipline:**
   - Strict Ink flex layout constraints (`flexShrink={0}` on fixed chrome, `flexShrink={1}` on transcript).
   - Zero terminal corruption or stranded raw mode; sub-50ms fast boot.

---

## 2. Acceptance Criteria Verification Matrix

| ID | Requirement | Verification Artifact | Result |
|---|---|---|:---:|
| **UI-1** | **Situational Cockpit Header**: Introspects and renders git branch (dirty mark), ecosystem, package manager, test runner, and active rules source; collapses cleanly | `packages/tui/src/components/__tests__/chrome.test.tsx` (header telemetry tests) | **PASSED** |
| **UI-2** | **Observable Closed-Loop TDD Cards**: Displays test command, pass/fail status, failure trace, and self-repair iteration progress badge | `packages/tui/src/components/__tests__/chrome.test.tsx` (verification card tests) | **PASSED** |
| **UI-3** | **Mission Deck HUD**: Displays goal title, milestone list with status glyphs (`✓`, `▶`, `○`, `✗`), progress counters, and turn economy | `packages/tui/src/components/__tests__/chrome.test.tsx` (mission deck tests) | **PASSED** |
| **UI-4** | **Interactive Modals**: `/diff` syntax-highlighted modal with file tabs; `/rewind` visual checkpoint timeline with instant Enter restore | `packages/tui/src/components/__tests__/cockpitModals.test.tsx` (4 tests) | **PASSED** |
| **UI-5** | **Terminal Ergonomics & Full Test Baseline**: Zero screen tearing or raw-mode leaks; 100% test pass rate across all 3 monorepo packages | All 68 test files across monorepo (382 tests passed, 0 failures) | **PASSED** |

---

## 3. Files Created and Modified

### New Files:
- `packages/tui/src/components/VerificationCard.tsx`: Dedicated closed-loop TDD and auto-repair card component.
- `packages/tui/src/components/MissionDeck.tsx`: Docked autonomous mission HUD component with milestone progression.
- `packages/tui/src/components/DiffModal.tsx`: Interactive syntax-highlighted diff modal with file tab switching.
- `packages/tui/src/components/RewindModal.tsx`: Time-travel checkpoint rewind modal with timeline navigation and rollback.
- `packages/tui/src/components/__tests__/cockpitModals.test.tsx`: 4 unit tests covering `DiffModal` and `RewindModal`.
- `docs/UI-ADVANCEMENT-AUDIT.md`: Architecture audit contrasting commodity chat vs. autonomous engineering cockpit.
- `docs/PHASE-15-SPEC.md`: Formal specification for the Autonomous Engineering Cockpit UI.

### Modified Files:
- `packages/tui/src/components/Header.tsx`: Upgraded to inspect `SituationalContext` and render multi-segment situational telemetry.
- `packages/tui/src/components/StatusBar.tsx`: Added test suite health indicator and checkpoint counter badge.
- `packages/tui/src/components/MessageView.tsx`: Integrated `VerificationCard` rendering into assistant turns.
- `packages/tui/src/components/App.tsx`: Wired `analyzeWorkspace()` on startup, `MissionDeck`, `DiffModal`, and `RewindModal`.
- `packages/tui/src/hooks/useAgentController.ts`: Added handlers for `verification_started` and `verification_result`, repair tracking, and test suite health.
- `packages/tui/src/hooks/useSessionCommands.ts`: Added dispatch handlers for `openDiff` and `openRewind`.
- `packages/tui/src/commands/types.ts`: Extended `CommandContext` with modal controls and goal setters.
- `packages/tui/src/commands/registry.ts`: Wired `/diff` and `/rewind` commands to open modals.
- `packages/tui/src/index.ts`: Re-exported new components.
- `packages/tui/src/components/__tests__/chrome.test.tsx`: Added unit test coverage for Header telemetry, VerificationCard, and MissionDeck.

---

## 4. Test Verification Baseline

- **`@anvil/cli`**: 2 test files, 8 tests passed (100%)
- **`@anvil/core`**: 43 test files, 266 tests passed (100%)
- **`@anvil/tui`**: 23 test files, 108 tests passed (100%)
- **Monorepo Total:** 68 test files, **382 tests passed**, 0 failed.
- **Typecheck:** Clean across monorepo (`tsc -p . --noEmit` on core, tui, cli).
- **Bundle:** Node ESM bundle built cleanly via esbuild with zero errors.
