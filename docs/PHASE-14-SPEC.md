# PHASE 14 SPEC — Autonomous Goal Engine & Situational Awareness ("True Agentic Power")

> **Status:** APPROVED & IN IMPLEMENTATION (Directive: "thats is the my goal is it have some agentic power and self understanding", 2026-09-06)  
> **Author:** Chief Engineer  
> **Target:** Anvil v0.6.0  

---

## 0. Vision & Core Philosophy

Anvil transitions from an **interactive reactive assistant** into an **autonomous mission operator with cognitive self-understanding**:
1. **Self-Understanding (Situational Awareness):**
   - The agent introspects its host environment, codebase topology, git status, toolchain, and project rules *before* acting, constructing an explicit mental model of where it is and what constraints exist.
2. **Autonomous Goal Engine (Mission Mode):**
   - Accepts a high-level goal (`--goal "<objective>"` or `/goal <objective>`).
   - Automatically decomposes the goal into a directed milestone plan (`GoalMilestone[]`).
   - Autonomously drives execution through each milestone: explores, mutates files, verifies tests, rewinds on failure, self-critiques, and iterates until the objective is satisfied.
   - Provides a comprehensive mission debriefing upon completion.

---

## 1. Subsystem Architecture

```
                               ┌────────────────────────────────┐
                               │           User Goal            │
                               │   (--goal "..." or /goal ...)  │
                               └───────────────┬────────────────┘
                                               │
                                               ▼
                               ┌────────────────────────────────┐
                               │     Situational Awareness      │
                               │  - Git branch, status, root    │
                               │  - Languages, package manager  │
                               │  - Build/test/lint scripts     │
                               │  - Workspace outline & rules   │
                               └───────────────┬────────────────┘
                                               │ (SituationalContext)
                                               ▼
                               ┌────────────────────────────────┐
                               │    Goal Decomposition & Plan   │
                               │  - Milestone 1: Recon & Setup  │
                               │  - Milestone 2: Implementation │
                               │  - Milestone 3: TDD Validation │
                               │  - Milestone 4: Self-Review    │
                               └───────────────┬────────────────┘
                                               │
                                               ▼
                               ┌────────────────────────────────┐
                               │ Autonomous Milestone Execution │
                               │  ┌──────────────────────────┐  │
                               │  │ 1. Pre-milestone snapshot│  │
                               │  │ 2. Targeted agent turns  │  │
                               │  │ 3. Closed-loop TDD check │  │
                               │  │ 4. Auto-rewind on broken │  │
                               │  │ 5. Mark milestone [x]    │  │
                               │  └──────────────────────────┘  │
                               └───────────────┬────────────────┘
                                               │
                                               ▼
                               ┌────────────────────────────────┐
                               │       Adversarial Review       │
                               │ - Critique diff for flaws      │
                               │ - Verify complete fulfillment  │
                               └───────────────┬────────────────┘
                                               │
                                               ▼
                               ┌────────────────────────────────┐
                               │    Final Mission Debriefing    │
                               │ (Milestones, diff, spend, log) │
                               └────────────────────────────────┘
```

---

## 2. Component Specifications

### 2.1 Situational Awareness Engine (`packages/core/src/agent/goal/awareness.ts`)
- **`analyzeWorkspace(projectRoot: string): Promise<SituationalContext>`**:
  - Gathers:
    - Repository name, root path.
    - Git status (current branch, clean/dirty state, uncommitted files count).
    - Project ecosystem: package manager (`npm`, `pnpm`, `yarn`, `cargo`, `go`), primary languages.
    - Available test and build commands from `package.json` or config.
    - Detected project rules (`.anvil/rules`, `AGENTS.md`).
    - Top-level directory topology.
  - Produces a concise summary string (`SituationalContext.summary`) injected into goal reasoning.

### 2.2 Goal Engine & Milestone Runner (`packages/core/src/agent/goal/goalEngine.ts`)
- **Types:**
  ```typescript
  export interface GoalMilestone {
    id: string;
    title: string;
    criteria: string;
    status: "pending" | "in_progress" | "completed" | "failed";
    summary?: string;
  }

  export interface GoalRunResult {
    goal: string;
    success: boolean;
    milestones: GoalMilestone[];
    totalTurns: number;
    filesChanged: string[];
    summary: string;
    criticVerdict?: string;
  }
  ```
- **Execution Lifecycle:**
  1. `decomposeGoal(goal, context)`: Model breaks high-level goal into 2–6 sequential milestones with verifiable criteria.
  2. Autonomous Iteration: Loops through milestones sequentially.
     - Creates rewind checkpoint before each milestone.
     - Drives `AgentSession` turns towards satisfying `milestone.criteria`.
     - Uses Phase 13 closed-loop TDD verification to ensure no test regressions.
     - If a milestone fails repeatedly, attempts tactical rollback via checkpoint rewind and alternative execution path.
  3. `adversarialCritique()`: Separate verification turn where the model reviews the session diff specifically for edge cases, security vulnerabilities, or incomplete requirements.
  4. Final synthesis: Emits structured `GoalRunResult`.

---

## 3. Interfaces & Entrypoints

- **CLI Flag:** `anvil --goal "<objective>"` runs headless mission mode.
- **TUI Slash Command:** `/goal <objective>` runs autonomous mission within interactive app with live milestone progress rendering.

---

## 4. Non-Goals

- NO unbounded infinite loops: Maximum 10 total turns per goal mission (`MAX_GOAL_TURNS = 10`), strictly enforced.
- NO uncontained file writes: Inherits existing path containment and security filters.
- NO reliance on external cloud services: All decomposition, situational awareness, and execution run purely on the configured LLM and local filesystem.

---

## 5. Acceptance Criteria

- **G1:** `analyzeWorkspace()` accurately detects project ecosystem, git branch, and available scripts.
- **G2:** `GoalEngine` decomposes a goal into concrete milestones with verifiable criteria.
- **G3:** `GoalEngine` executes milestones sequentially, updating milestone status from pending to completed.
- **G4:** Pre-milestone checkpointing protects workspace integrity and enables rewind on failure.
- **G5:** Adversarial critique phase audits final diff before debriefing.
- **G6:** Full test coverage with automated unit and integration tests.
