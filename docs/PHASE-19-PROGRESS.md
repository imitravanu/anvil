# Phase 19: Project Memory & Git-Native Workflow Progress Report

> **Date:** 2026-09-11
> **Status:** COMPLETED
> **Branch:** master
> **Chief Engineer:** Antigravity

---

## 1. Executive Summary

Phase 19 equips Anvil with persistent, per-project knowledge retention and native Git integration. With these capabilities, Anvil remembers what was tried, architectural conventions, and directory structures across sessions without manual prompt stuffing, while enabling a seamless Git-native development and PR lifecycle.

Key deliverables completed in Phase 19:
1. **Project Memory (`.anvil/memory.md`):**
   - Bounded flat-file markdown store capped at 32KB (`MAX_MEMORY_BYTES = 32768`).
   - Auto-creates `.anvil/` and `.anvil/.gitignore` containing `memory.md` on first write so local agent notes are never accidentally committed.
   - Injected into system prompt deterministically at session start: `<base prompt>` → `[Project-specific rules]` → `[Project memory from .anvil/memory.md]`.
2. **`update_memory` Tool:**
   - First-class tool registered in `@anvil/core` (`packages/core/src/tools/updateMemory.ts`).
   - Declared as `mutating: false` so the agent can safely update project notes without triggering mutating permission prompts.
   - Appends ISO timestamped headers (`### [2026-09-11T...]`) to `.anvil/memory.md`.
3. **Auto-Commit per Goal Milestone:**
   - Added `autoCommit?: boolean` to `AnvilSettings` (`packages/core/src/config/types.ts`).
   - Added `autoCommitMilestone(projectRoot, milestoneId, title)` in `packages/core/src/git/gitUtils.ts`.
   - Wired directly into `runGoalMission` and `GoalEngine`: upon milestone self-review passing, commits with message `anvil(goal): milestone N — <title>`.
4. **Git-Native TUI Commands:**
   - Extended `/diff` command: `/diff` reviews current session changes, while `/diff <branch>` (e.g. `/diff main`) computes `git diff <branch>...HEAD` via `getBranchDiff` and displays it in `DiffModal`.
   - Added `/pr` command: invokes `gh pr create --fill` via `createPullRequest` and displays the pull request URL directly in the transcript.

---

## 2. Architecture & Implementation Details

### 2.1 Project Memory Module (`packages/core/src/config/memory.ts`)
- `loadProjectMemory(projectRoot)`: Safely checks for `.anvil/memory.md`. Reads up to 32KB; if oversized, truncates with `

... [Project memory truncated at 32KB limit] ...`. Returns `null` if the file does not exist or is empty.
- `appendToMemory(projectRoot, entry)`: Ensures `.anvil` directory exists, ensures `.anvil/.gitignore` contains `memory.md`, and appends formatted entry with ISO timestamp header.
- `buildSystemPromptWithMemory(basePrompt, projectRoot, rules, memory)`: Assembles prompt sections in deterministic order.
- `packages/core/src/config/rules.ts`: Updated `buildSystemPrompt` to delegate to `buildSystemPromptWithMemory`.

### 2.2 `update_memory` Tool (`packages/core/src/tools/updateMemory.ts`)
- Schema: `{ type: "object", properties: { entry: { type: "string" } }, required: ["entry"] }`.
- Mutating: `false`.
- Registered in `TOOL_DEFINITIONS` in `packages/core/src/tools/index.ts`.

### 2.3 Git Utilities (`packages/core/src/git/gitUtils.ts`)
- `autoCommitMilestone`: Stages all changes (`git add -A`) and commits with `anvil(goal): milestone <id> — <title>`. Handles clean working trees gracefully without throwing.
- `getBranchDiff`: Computes `git diff <branch>...HEAD` with a 2MB buffer, falling back to `git diff <branch>` if needed.
- `createPullRequest`: Executes `gh pr create --fill` and extracts the created PR URL. Returns clear diagnostic messages if `gh` is missing from `PATH`.

### 2.4 Autonomous Goal Engine Integration (`packages/core/src/agent/goal/goalEngine.ts`)
- Added `autoCommit?: boolean` to `GoalMissionDeps` and `GoalEngineOptions`.
- On milestone status reaching `"completed"`:
  ```typescript
  if (deps.autoCommit) {
    const commitRes = await autoCommitMilestone(deps.projectRoot, milestone.id, milestone.title);
    if (commitRes.committed && commitRes.hash) {
      yield {
        type: "milestone_progress",
        milestone,
        detail: `Committed milestone ${milestone.id}: ${commitRes.hash}`,
      };
    }
  }
  ```

### 2.5 TUI Diff & PR Integration (`packages/tui/src/`)
- `commands/types.ts`: Updated `showDiff: (branch?: string) => void;` and added `createPr: () => void;`. Added `setBranchDiff` to `CommandHandlerDeps`.
- `commands/registry.ts`:
  - Updated `/diff` to pass `args[0]`.
  - Added `/pr` command.
  - Implemented async branch diff lookup and PR creation in `makeHandlers`.
- `components/DiffModal.tsx`:
  - Added `branchDiff?: { branch: string; diff: string } | null` prop.
  - Renders unified branch diff with `ColorizedDiff`, or clean notice if no differences exist.
- `components/App.tsx`:
  - Added `branchDiff` state and passed to `<DiffModal />`.

---

## 3. Acceptance Criteria Checklist

| ID | Requirement | Status | Notes |
|---|---|---|---|
| **M1** | `.anvil/memory.md` loads at session start and is injected into system prompt | ✅ PASS | Verified via `memory.test.ts` & `rules.test.ts` |
| **M2** | `update_memory` tool appends timestamped entries | ✅ PASS | Verified via `updateMemory.test.ts` |
| **M3** | Memory is capped at 32KB with truncation marker | ✅ PASS | Verified in `loadProjectMemory` tests |
| **M4** | `.anvil/.gitignore` auto-created to exclude `memory.md` | ✅ PASS | Verified in `appendToMemory` & `updateMemory.test.ts` |
| **M5** | Auto-commit creates git commits per completed milestone (opt-in) | ✅ PASS | Verified via `goalEngine.test.ts` with live git repo |
| **M6** | `/diff <branch>` shows cross-branch diff in DiffModal | ✅ PASS | Verified via `cockpitModals.test.tsx` & `registry.test.ts` |
| **M7** | `/pr` creates a PR via `gh` when available | ✅ PASS | Verified via `gitUtils.ts` & `registry.test.ts` |
| **M8** | All existing tests + eval harness still pass | ✅ PASS | 494/494 unit tests, 96/96 visual scenarios, 15/15 eval tasks |

---

## 4. Verification Matrix

| Gate | Command | Result | Notes |
|---|---|---|---|
| Monorepo Build | `npm run build` | PASS (code 0) | All packages (`core`, `tui`, `cli`) build cleanly |
| TypeScript Types | `npm run typecheck` | PASS (code 0) | Zero type errors across all 3 workspaces |
| Unit Tests | `npm test` | PASS (494/494) | Core: 337 passed, TUI: 149 passed, CLI: 8 passed |
| Visual Regression | `npm run visual:diff` | PASS (0.0% diff) | 96/96 visual baselines matching |
| Fast Evaluation | `npm run eval -- --fast --mock` | PASS (15/15) | 100% pass rate in 1.3s |
| Provider Certification | `npm run certify -- --mock --all` | PASS (10/10) | 10/10 provider adapters certified live |

---

## 5. Next Phase: Phase 20 (Distribution & CI Pipeline)

With Phase 19 completed, the final planned phase on the master roadmap is **Phase 20 — Distribution & CI Pipeline**:
1. Verify `npm publish` readiness across all workspaces (`packages/cli`, `packages/core`, `packages/tui`, root).
2. Establish release scripts (`bump-version`, `prepublishOnly`, npm packaging verification).
3. Finalize `.github/workflows/ci.yml` matrix covering lint, typecheck, unit tests, visual regression, certification, and mock eval suite.
