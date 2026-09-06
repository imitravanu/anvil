# UI ARCHITECTURAL AUDIT & ADVANCEMENT SPECIFICATION
## From "Generic Chat Box" to "Autonomous Engineering Cockpit"

> **Author:** Chief Engineer  
> **Target Subsystem:** `@anvil/tui`  
> **Date:** 2026-09-06  
> **Status:** PROPOSED ARCHITECTURAL BLUEPRINT (Phase 15.0)

---

## 1. Executive Assessment: The Cognitive Mismatch

Over Phases 11–14, Anvil developed genuine autonomous agentic capabilities:
- **Situational Awareness:** Introspects git branch/status, language ecosystem, package manager, test runners, and standing rules (`AGENTS.md`).
- **Closed-Loop TDD Auto-Verification & Self-Repair:** Executes test suites post-mutation, captures stack traces, and drives autonomous self-repair attempts before completing turns.
- **Autonomous Goal Engine:** Decomposes high-level objectives into sequential milestones, manages bounded turn loops, and conducts adversarial self-critique.
- **Checkpoint Rewind:** Tracks persistent file snapshots with hash-addressed integrity and single-command rollback.

### The Problem
While Anvil's cognitive core has evolved into an **autonomous mission operator**, its user interface (`@anvil/tui`) remains structured like a **commodity 2023 chat box**:
1. **Passive Linear Transcript:** Everything (prose, tool calls, errors, notifications) is dumped sequentially into a single scrolling vertical message list.
2. **Situational Blindness:** The user has no visual confirmation that Anvil understands the workspace (git branch, clean/dirty state, test runner, ecosystem).
3. **Invisible Verification & Self-Repair:** Phase 13 events (`verification_started`, `verification_result`, `repair_attempt_started`) are currently dropped by `useAgentController.ts`. The user cannot see test runs or autonomous self-repair in action.
4. **Fragile Milestone Representation:** `PlanLine.tsx` is a flat 2-line text banner (`plan ▸ ...`), incapable of displaying multi-step milestone DAGs, milestone statuses (`pending`, `in_progress`, `completed`), or live progress.
5. **Text-Dump Inspection:** Power commands like `/diff`, `/ledger`, and `/rewind` dump plain text strings into the transcript instead of leveraging terminal-native syntax colorization and interactive selection.

---

## 2. Component-by-Component Audit of `@anvil/tui`

| Component / Hook | Current Implementation | Architectural Limitation | Required Advancement |
|---|---|---|---|
| [`Header.tsx`](file:///home/mitravanu/Projects/anvil/packages/tui/src/components/Header.tsx) | Displays `▲ ANVIL` on left; `Provider · Model · state` on right | Complete situational blindness. Zero display of repo, git branch, clean/dirty state, or rules. | **Cockpit Header**: Multi-segment telemetry line showing Repo, Branch (clean/dirty), Ecosystem, Test Runner, and Active Rules. |
| [`PlanLine.tsx`](file:///home/mitravanu/Projects/anvil/packages/tui/src/components/PlanLine.tsx) | Collapsed 2-line string banner (`plan ▸ ...`) | Only reacts to `plan_updated` text; cannot render milestones, progress, or verification states. | **Mission Deck (`GoalHUD.tsx`)**: Structured milestone HUD displaying active milestone, completion badges, and real-time step detail. |
| [`StatusBar.tsx`](file:///home/mitravanu/Projects/anvil/packages/tui/src/components/StatusBar.tsx) | Model label, spinner, token in/out totals, context gauge, static hotkey hints | Passive token counter. Does not display test suite health, checkpoint count, or active goal status. | **Telemetry Bar**: Adds Test Suite status indicator (`🧪 374 passed`), Checkpoint gauge (`⎌ 3 snapshots`), and interactive hotkey hints. |
| [`MessageView.tsx`](file:///home/mitravanu/Projects/anvil/packages/tui/src/components/MessageView.tsx) | Renders user prompt, assistant text, and `ToolCallView` rows | Ignores verification events, self-repair loops, and goal milestone transitions. | **Verification & Self-Repair Cards**: Visual badges for test runs, test failure traces, and self-repair iterations. |
| [`useAgentController.ts`](file:///home/mitravanu/Projects/anvil/packages/tui/src/hooks/useAgentController.ts) | Switches on `text_delta`, `tool_*`, `usage`, `error`, `checkpoint`, `subagent_*` | Drops `verification_started`, `verification_result`, `repair_attempt_started`, and all `GoalEvent`s. | **Unified Autonomous Event Bus**: Parses, tracks, and surfaces closed-loop TDD verification and goal milestones in state. |
| Commands (`/diff`, `/rewind`) | Dumps raw text strings into `printSystemMessage()` | Misses existing `ColorizedDiff` component; `/rewind` requires manual number entry instead of a visual timeline. | **Interactive Viewers**: Fullscreen modal for `/diff` with syntax-highlighted side-by-side or unified diff, and interactive `/rewind` timeline picker. |

---

## 3. The "Agent Cockpit" Design Blueprint

### 3.1 Visual Architecture & Layout Wireframe

```
┌─ ▲ ANVIL ── repo: anvil (master*) ── env: node (pnpm) ── tests: vitest ── rules: AGENTS.md ───────────────┐
│                                                                                                             │
│  ❯ you                                                                                                      │
│    /goal Add JWT authentication and route protection middleware                                             │
│                                                                                                             │
│  anvil                                                                                                      │
│    I have analyzed the workspace topology and decomposed the mission into 3 sequential milestones.          │
│                                                                                                             │
│    ⚙ [get_outline] src/auth/index.ts ✓                                                                      │
│    ⚙ [write_file] src/auth/jwt.ts ✓ (1.2 KB written)                                                        │
│                                                                                                             │
│    ┌─ 🧪 Closed-Loop TDD Auto-Verification ──────────────────────────────────────────────────────────────┐  │
│    │  Command: pnpm test                                                                                  │  │
│    │  ✗ 1 Test Failed: src/auth/jwt.test.ts (AssertionError: expected 401 to be 200)                      │  │
│    │  🔧 Auto-Repair Attempt 1/2: Feeding failure trace back into reasoning...                             │  │
│    │  ✓ Self-Repair Successful: Re-run verified (12/12 passed, 240ms)                                     │  │
│    └──────────────────────────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                                             │
├─────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ 🎯 MISSION DECK: "Add JWT authentication and route protection middleware" (Turn 3/10)                       │
│  [✓] 1. Reconnaissance & Auth Interface Design (Outline inspected)                                          │
│  [▶] 2. Implement Token Sign & Verification (Running tests: vitest... self-repair 1/2)                      │
│  [ ] 3. Wire Route Guards & Protect Endpoints                                                               │
├─────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ ❯ input prompt or slash command (/diff, /rewind, /ledger, /goal)...                                         │
├─────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ anthropic/claude-3-7 · idle │ 🧪 tests: green │ ⎌ 4 checkpoints │ 7.2k/200k (3%) │ tokens 1.2k in · 480 out   │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Key Subsystem Specifications

### 4.1 Cockpit Header (`packages/tui/src/components/CockpitHeader.tsx`)
Introspects `SituationalContext` on boot and session change:
- **Left segment:** `▲ ANVIL` in theme primary brand color.
- **Center segments:**
  - `repo: <name> (<branch><dirtyMarker>)` — highlighted yellow if uncommitted files exist.
  - `env: <ecosystem> (<pkgManager>)`
  - `tests: <testScript>`
  - `rules: <rulesSource>`
- **Right segment:** Active Model + Pricing tag (`[free]` / `[paid]`).

### 4.2 Mission Deck HUD (`packages/tui/src/components/MissionDeck.tsx`)
A docked, high-density panel positioned directly above the input bar during active missions:
- Shows overall goal title, progress counter (`Milestone 2/3`), and turn economy (`Turn 3/10`).
- Renders each milestone with real-time status badges:
  - `[✓]` Completed (dim/green)
  - `[▶]` In Progress (accent/spinner with live detail)
  - `[ ]` Pending (dim)
  - `[✗]` Failed (red with repair alert)
- Automatically hides or collapses to 1 line when idle to preserve transcript real estate.

### 4.3 Closed-Loop TDD Verification Card (`packages/tui/src/components/VerificationCard.tsx`)
Integrated into `MessageView.tsx` whenever `session.ts` executes auto-verification:
- Distinct framed card with rounded border and subtle background contrast.
- Visual stages:
  1. `Verifying test suite...` (spinner)
  2. `Test Suite Passed` (green checkmark, pass count, duration)
  3. `Test Suite Failed` (red cross, failure summary, affected test file)
  4. `Autonomous Self-Repair Attempt N/2` (amber wrench, streaming repair status)
  5. `Repair Verified & Green` (celebration checkmark)

### 4.4 Interactive Diff Inspector (`packages/tui/src/components/DiffModal.tsx`)
Replaces flat transcript text dumping on `/diff`:
- Uses existing `ColorizedDiff` engine (`colorizeDiff.tsx`) with word-level diffing and line numbers.
- File selector tab bar for multi-file sessions (`[ auth.ts* ] [ jwt.ts* ] [ index.ts ]`).
- Full terminal height utilization with smooth scrolling (`Up`/`Down`/`PageUp`/`PageDown`).
- `Esc` closes and returns focus instantly to the input bar.

### 4.5 Interactive Checkpoint Timeline (`packages/tui/src/components/RewindModal.tsx`)
Replaces manual numeric typing on `/rewind`:
- Shows visual time-travel timeline of all snapshots created in the session.
- Displays: checkpoint index, timestamp, number of files changed, and triggering tool action.
- Arrow keys to select target checkpoint; `Enter` restores instantly; `Esc` cancels.

---

## 5. Non-Generic Engineering Constraints

1. **Terminal Ergonomics & Zero-Flicker:**
   - Strict adherence to Ink flex-shrink rules: fixed-height zones (`flexShrink={0}`) must never get compressed by transcript growth.
   - Bounded re-renders: Avoid re-parsing markdown or diffs during streaming.
2. **Resource Footprint:**
   - Zero additional runtime dependencies (no heavy canvas, no bloat libraries). Pure Ink + React terminal primitives.
   - Startup latency overhead: <5ms for situational header introspection.
3. **Graceful Fallbacks:**
   - If terminal width <80 columns or height <20 rows, gracefully collapse multi-segment headers and HUDs into compact single-line indicators.
