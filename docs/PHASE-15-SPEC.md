# PHASE 15 SPEC — The Autonomous Agent Cockpit UI

> **Status:** APPROVED & IN IMPLEMENTATION (2026-09-06)  
> **Author:** Chief Engineer  
> **Target:** Anvil v0.6.0  
> **Subsystems:** `@anvil/tui`, `@anvil/core`, `@anvil/cli`

---

## 0. Vision & Core Philosophy

Anvil’s user interface evolves from a traditional 2023 chat box into a high-density, terminal-native **Autonomous Engineering Cockpit**:
1. **Situational Grounding**: Real-time environmental introspection (git branch, clean/dirty state, ecosystem, package manager, test runner, standing rules) anchored in the Cockpit Header.
2. **Observable Closed-Loop Verification**: Visual verification cards and self-repair badges that make test runs, failure traces, and autonomous repairs immediately tangible.
3. **Mission Deck HUD**: A docked, dynamic milestone HUD that visualizes autonomous goal progression without cluttering the scrolling transcript.
4. **Interactive Inspectors**: Dedicated modal overlays for `/diff` (syntax-highlighted, word-diffed) and `/rewind` (visual checkpoint timeline with instant rollback).

---

## 1. Acceptance Criteria

- **UI-1: Situational Cockpit Header**:
  - Automatically gathers `SituationalContext` via `analyzeWorkspace()`.
  - Displays repository name, git branch (with dirty indicator in amber), ecosystem, package manager, detected test runner, and standing rules source.
  - Gracefully collapses on narrow terminals (<80 columns).
- **UI-2: Observable Closed-Loop TDD & Self-Repair Cards**:
  - `useAgentController` handles `verification_started`, `verification_result`, and `repair_attempt_started`.
  - `MessageView` renders a framed `VerificationCard` showing test command, pass/fail state, failure snippet, and self-repair iteration progress (e.g. `Repair attempt 1/2`).
- **UI-3: Mission Deck HUD (`MissionDeck.tsx`)**:
  - Renders active autonomous mission goal, milestone list, status badges (`[✓]`, `[▶]`, `[ ]`, `[✗]`), and turn budget (`Turn N/10`).
  - Docks above the input bar during active missions; smoothly collapses to zero rows when idle.
- **UI-4: Interactive Diff & Checkpoint Time-Travel Modals**:
  - `/diff` opens a modal viewer utilizing `ColorizedDiff` with line/word diffs, multi-file navigation, and keyboard scrolling.
  - `/rewind` opens an interactive checkpoint timeline showing snapshot IDs, timestamps, modified file counts, and 1-key instant rollback on `Enter`.
- **UI-5: Strict Terminal Ergonomics & Monorepo Test Baseline**:
  - Preserves Ink flex layout discipline (`flexShrink={0}` on fixed zones, `flexShrink={1}` on transcript).
  - Zero terminal corruption or stranded raw mode.
  - 100% pass rate on all existing and new unit tests across `@anvil/core`, `@anvil/tui`, and `@anvil/cli`.

---

## 2. Component Architecture

```
┌─ CockpitHeader (Repo, Git Branch*, Env, Test Runner, Rules, Model) ────────┐
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│ MessageList (Scrollable Transcript)                                        │
│   ├── UserTurn (Prompt, Attached Images)                                   │
│   └── AssistantTurn                                                        │
│         ├── MarkdownText / StreamingCaret                                  │
│         ├── ToolCallView (get_outline, edit_file, etc.)                    │
│         ├── VerificationCard (Test command, status, self-repair loops)     │
│         └── SubAgentView                                                   │
│                                                                            │
├────────────────────────────────────────────────────────────────────────────┤
│ MissionDeck HUD (Docked when /goal or multi-step mission is active)         │
│   ├── Goal Title & Turn Economy                                            │
│   └── Milestone DAG ([✓] Done, [▶] Running + Detail, [ ] Pending)          │
├────────────────────────────────────────────────────────────────────────────┤
│ Overlays: PermissionPrompt | DiffModal | RewindModal | ModelPicker         │
│ Fallback: InputBar (Prompt, History Recall, /help)                         │
├────────────────────────────────────────────────────────────────────────────┤
│ StatusBar (Model, Spinner, Test Health, Checkpoints, Context Gauge, Hints) │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Phased Execution Plan

- **Step 1:** Situational Cockpit Header & Telemetry Bar in `@anvil/tui`.
- **Step 2:** Event bus integration in `useAgentController` and `VerificationCard` rendering.
- **Step 3:** Mission Deck HUD (`MissionDeck.tsx`) replacing flat `PlanLine`.
- **Step 4:** Interactive `DiffModal` and `RewindModal`.
- **Step 5:** Verification suite, documentation updates, and regression testing.
