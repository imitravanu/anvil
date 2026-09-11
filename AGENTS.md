# 🛡️ ANVIL AGENT CONSTITUTION & ENGINEERING PROTOCOL (v2.2)

> **MANDATORY DIRECTIVE FOR ALL AI AGENTS (Claude, Cursor, Copilot, Antigravity, OpenCode, Aider, etc.):**  
> Before modifying any file in this repository, you **MUST** read and strictly follow this constitution. Any pull request, commit, or patch that violates these rules will be rejected by the automated gate (`npm run gate`) and discarded on review.

---

## 1. 📋 MANDATORY ENTRY PROTOCOL (Before Modifying Any Code)

1. **Read Rules & Master Roadmap:**  
   Consult [`docs/PHASE-21-25-ROADMAP.md`](docs/PHASE-21-25-ROADMAP.md) and [`docs/ANTI-SLOP-GATE-PLAN.md`](docs/ANTI-SLOP-GATE-PLAN.md) to confirm the active phase and architectural scope. Never skip ahead to future features while earlier security or logic tasks remain open.

2. **Multi-Agent Collision Guard:**  
   Declare file ownership before editing. When multiple AI agents or user sessions are operating concurrently on this repository, **NEVER** edit files actively touched or owned by another agent. Cross-boundary modifications require coordination in `PROGRESS.md`.

3. **Verify Reality Before Modifying:**  
   Verify all file paths, symbol names, and line references against the live working tree before taking action. Roadmaps and plans are guides; live code is truth.

4. **Check Existing Helpers First:**  
   Before authoring a new utility function or helper, check if one already exists in `@anvil/core` or your package's local utilities.

---

## 2. ⛔ STRICT DONT's (Anti-Slop Directives)

1. **NO Sequential Raw Error Formatting:**  
   NEVER copy-paste `err instanceof Error ? err.message : String(err)`. Always import and use `getErrorMessage(err)` from `@anvil/core`.

2. **NO `as any` or `as never` Type Casting:**  
   NEVER use `as any` or `as never` to bypass compiler checks. Use proper TypeScript discriminated unions, type narrowing (`typeof`, `instanceof`), or pure type predicates. (Unit test mock fixtures are exempt where noted).

3. **NO Silent `catch {}` Blocks:**  
   NEVER write an empty catch block (`catch {}` or `catch (e) {}`). Every catch block must either log an actionable warning via `console.warn` / `console.error`, or include an explicit one-line comment explaining why swallowing the error is intentional and safe (`// intentional: <reason>`). Never import non-existent loggers.

4. **NO Hardcoded Magic Constants:**  
   NEVER introduce arbitrary raw numbers for timeouts, buffer caps, or retry limits. Import centralized constants from `@anvil/core` (`packages/core/src/config/constants.ts`).

5. **NO Architecture Boundary Violations:**  
   `packages/core` must **NEVER** import anything from `@anvil/tui` or `@anvil/cli`. Core is a standalone, headless engine.

6. **NO Hardcoded UI Color Strings:**  
   TUI components in `packages/tui/src/components/` must **NEVER** use literal color strings (e.g. `color="cyan"`, `borderColor="green"`). ALL colors must derive from the active theme via `useTheme()`.

7. **NO Documentation Bloat:**  
   Keep inline comments concise, explaining *why* something is done rather than restating *what* the syntax does. Avoid essay-length comments and avoid generating unnecessary markdown files for minor decisions.

8. **NO Dead Production Exports:**  
   NEVER export a new production symbol without a corresponding production caller within the same change.

---

## 3. ✅ STRICT DO's (Sacred Engineering Rules)

1. **The Sacred Monorepo Build Order:**  
   Anvil packages compile against built artifacts in `dist/`, not raw sources. Workspace builds must run in this exact sequential order:
   ```bash
   npm run build -w @anvil/core && npm run build -w @anvil/tui && npm run build -w @anvil/cli
   ```

2. **Run the Full Gate Before Submission:**  
   Before declaring any task or turn complete, you **MUST** run:
   ```bash
   npm run gate
   ```
   If `npm run gate` fails, you are NOT done. You must fix the issue.

3. **Definition of Done & Review Teeth:**  
   All contributions must achieve a 100% green gate across build, typecheck, unit tests, and mock evals.  
   **Working code that skipped the entry protocol is rejected the same as broken code.** Any contribution that passes the mechanical gate but caused multi-agent collisions, skipped file ownership declarations, or violated architectural boundaries will be rejected on peer review.

---

## 4. 🚪 The Guardian Gate Pipeline

Every contribution is mechanically verified by `npm run gate`:
1. **Step 0:** Gate sensor test (verifies gate detection integrity).
2. **Step 1:** Diff Slop & Quality Scanner (scans newly added lines for forbidden patterns).
3. **Step 2:** Monorepo sequential build (`core ➔ tui ➔ cli`) with explicit timeouts.
4. **Step 3:** TypeScript type checking across all 3 workspaces (`npm run typecheck`).
5. **Step 4:** Unit test suite execution (`npm test`).
6. **Step 5:** Verification harness mock runner (`npm run eval -- --fast --mock`).

---

**Violating any rule above will break the project build. Stay disciplined.**
