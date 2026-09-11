# 🛡️ ANTI-SLOP GATE — Master Operational Blueprint (v2.2 Ratified)

> **Status:** RATIFIED BLUEPRINT  
> **Version:** 2.2 — Fully harmonized with Muse Spark review (incorporating V1–V6 fixes, zero phantom symbols, multi-agent collision control, and gate rot sensors).  
> **Rule Zero:** Every rule in the constitution must reference something that exists in code at the time the rule goes live. No forward-dated mandates.

---

## §0. Why v1 Failed (Lessons Encoded & Resolved)

| Defect | Root Cause | v2.2 Permanent Resolution |
|---|---|---|
| **D1 Phantom Imports** | `AGENTS.md` ordered imports from `constants.ts` and `getErrorMessage` before they were created. | **Phase 1 Foundation First:** Build and verify helper modules *before* enacting the constitution. |
| **D2 Blind Scanner** | Diff scanner checked `as any` and empty catches, but missed the #1 slop pattern: 40+ copy-pasted `instanceof Error` ternaries. | **Phase 3 Pattern Hardening:** Diff scanner explicitly flags `instanceof Error ? ... : String(`. |
| **D3 Gate Self-Slop** | `verify-gate.mjs` contained an empty `catch {}`, lacked child process timeouts, and had loose bypass flags. | **Zero Self-Slop:** Every `execSync` call has an explicit timeout (`180s`), catches are logged, and bypasses require recorded receipts. |
| **D4 Sprawl Commit** | Gate was introduced into a 46-file dirty working tree, making diff review impossible. | **Isolated Commits:** Gate foundation, constitution, and runner land in 3 distinct, clean commits. |

---

## §1. Phase 1 — Foundation First (Helpers Before Rules)

Build the two core modules in `@anvil/core` before any rules mandate them. Zero behavior regression.

### 1.1 Safe Error Message Extractor (V6 Resolved)
* **Path:** `packages/core/src/errors.ts` *(leaf module alongside `atomicWrite.ts`, avoiding sibling naming collisions with `packages/tui/src/util/errors.ts`)*.
* **Export:** Exported from `@anvil/core` root (`packages/core/src/index.ts`).
* **Implementation:**
  ```ts
  export function getErrorMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    if (typeof err === "string") return err;
    if (err && typeof err === "object" && "message" in err && typeof (err as { message: unknown }).message === "string") {
      return (err as { message: string }).message;
    }
    return String(err);
  }
  ```
* **Acceptance:** Full unit test suite (`packages/core/src/__tests__/errors.test.ts`) covering Error instances, custom subclasses, raw strings, objects with message, and primitives.

### 1.2 Centralized Core Constants (Seed)
* **Path:** `packages/core/src/config/constants.ts`
* **Export:** Exported from `packages/core/src/config/index.ts` and `@anvil/core` root.
* **Scope:** Seed only the essential operational limits touched by new code (timeouts, buffer caps, retry counts, token thresholds).
* **Acceptance:** Module compiles cleanly under `tsc -p tsconfig.build.json`.

### 1.3 Commit 1
`feat(core): introduce getErrorMessage helper and centralized constants foundation`

---

## §2. Phase 2 — Constitution v2.2 (`AGENTS.md`)

Injected dynamically into AI agent system contexts via project rules. Every rule references real, existing symbols.

### Entry Protocol (Mandatory Before Coding)
1. **Read Rules & Scope:** Read `AGENTS.md` and the active phase roadmap before touching any file.
2. **Multi-Agent Collision Guard (V3 Resolved):** Declare file ownership before modifying code. When multiple AI agents or sessions are active, never modify files actively touched or owned by another agent. Cross-boundary modifications require coordination in `PROGRESS.md`.
3. **Verify Reality Before Modifying:** Verify all file:line references before modifying (plans are hunt maps; code is truth).
4. **Check Existing Helpers First:** Check existing helpers before authoring any new utility function.

### The 10 Engineering DOs & DONTs
1. **NO Sequential Raw Error Formatting:** Always import and use `getErrorMessage(err)` from `@anvil/core`. Never paste `err instanceof Error ? err.message : String(err)`.
2. **NO `as any` or `as never`:** Use proper TypeScript discriminated unions, type narrowing, or generics.
3. **NO Silent `catch {}` Blocks (V1 Resolved):** Every catch block must either log an actionable warning via `console.warn`, or include an explicit comment explaining why swallowing the error is intentional and safe (`// intentional: <reason>`). Never import non-existent loggers.
4. **NO Hardcoded Magic Constants:** Import standard timeouts, byte caps, and retry counts from `@anvil/core`.
5. **NO Architecture Boundary Violations:** `packages/core` must **NEVER** import anything from `@anvil/tui` or `@anvil/cli`.
6. **NO Hardcoded UI Colors:** Component JSX must never use literal color strings (`color="cyan"`). All styling must derive from `useTheme()`.
7. **NO Documentation Bloat:** Keep inline comments concise and purposeful (explain *why*, not *what*). Do not write essay comments; do not create unnecessary markdown files for minor decisions.
8. **NO Dead Production Exports:** Every new production export must have a real caller in the production codebase.
9. **Follow Sacred Build Order:** Core ➔ TUI ➔ CLI (`npm run build -w @anvil/core && npm run build -w @anvil/tui && npm run build -w @anvil/cli`).
10. **Definition of Done & Review Teeth (V2 Resolved):** All changes must pass `npm run gate` before being submitted. **Working code that skipped the protocol is rejected the same as broken code.** A contribution that passes the gate but skipped the entry protocol or caused multi-agent collisions is rejected on review.

### Commit 2
`docs(agents): ratify v2.2 agent constitution and multi-agent engineering standards`

---

## §3. Phase 3 — Hardened Gate Runner (`scripts/verify-gate.mjs`)

Mechanically enforces the constitution on every contribution via:
```bash
npm run gate
```

### Gate Execution Sequence (Fail-Fast)
0. **Step 0 — Gate Sensor Test (V4 Resolved):**
   - Automated self-check verifying that `verify-gate.mjs` correctly detects and rejects intentional test violations (`as any`, empty catch). Prevents silent gate rot.
1. **Step 1 — Diff Slop & Quality Scanner (Zero-Dependency):**
   - Scans newly added lines (`+` diff lines) against `HEAD` or staged index.
   - Flags forbidden type escapes (`as any`, `as never`).
   - Flags silent catches (`catch {}` or `catch (e) {}` with no body).
   - Flags boundary breaches (`@anvil/core` importing `tui` or `cli`).
   - Flags hardcoded UI colors in `packages/tui/src/components/`.
   - Flags copy-pasted error formatting (`instanceof Error ? ... : String(`).
   - Flags leftover placeholder markers (`TODO`, `FIXME`, `XXX`).
2. **Step 2 — Monorepo Sequential Build Gate:**
   - Builds `@anvil/core` ➔ `@anvil/tui` ➔ `@anvil/cli`.
   - Hard timeout: `180,000ms` (3 minutes).
3. **Step 3 — Typecheck Gate:**
   - Full TypeScript typecheck across all workspaces (`npm run typecheck`).
   - Hard timeout: `120,000ms` (2 minutes).
4. **Step 4 — Unit Test Suite Gate:**
   - Vitest suite across all workspaces (`npm test`).
   - Hard timeout: `180,000ms` (3 minutes).
5. **Step 5 — Mock Eval Benchmark Gate:**
   - Verification harness runner (`npm run eval -- --fast --mock`).
   - Hard timeout: `180,000ms` (3 minutes).

### Gate Self-Compliance Guarantee
* Zero silent catches inside `verify-gate.mjs` (all fallback errors logged to `stderr`).
* Every child process command runs with strict `timeout` options to prevent pipeline hangs.
* **`.fresh-allowlist.json`:** Known legacy exceptions are tracked in a committed JSON file with specific file, line, and expiration phase. The allowlist can only shrink, never grow without human approval.

### Commit 3
`feat(qa): introduce hardened guardian gate runner and automated verification script`

---

## §4. Phase 4 — Deployment & Immediate Protection

* **No 7-Day "Warn-Week":** The gate activates in **hard-fail mode immediately upon landing**. Immediate active protection from Day 1.
* **Clean Baseline Checkpoint:** The 46 modified files from pre-Phase 21 maintenance are verified and committed prior to starting Phase 21 security tasks.
* **CI Integration:** Wire `npm run gate` into GitHub Actions (`ci.yml`) to ensure every remote PR satisfies the exact same local verification.

---

## §5. Strict Bypass Protocol (The Escape Hatch With a Receipt)

If an urgent hotfix requires bypassing a gate check, it is permitted **ONLY** under all 3 conditions:
1. **Explicit User Approval:** Documented in the session transcript.
2. **Commit Tag:** Commit message must use the prefix `BYPASS: <reason>`.
3. **Technical Debt Repayment:** A follow-up task must be scheduled immediately to resolve the violation and restore clean compliance.

---

## §6. Deferred Items & Evolution Triggers (V5 Resolved)

To keep the pipeline lean while preserving institutional memory, the following capabilities are documented with explicit activation triggers:

| Mechanism | Current Status | Activation Trigger |
|---|---|---|
| **Duplication Scanner (`jscpd`)** | Deferred | Activated if copy-pasted blocks (>50 tokens) are detected across 2 or more distinct PRs. |
| **Strict File Size Caps (500L/80L)** | Deferred to Phase 24 | Activated during Phase 24 monster-file modularization tracks (`send()`, `useAgentController()`). |
| **Formal Architecture Decision Records (ADRs)** | Deferred | Reserved exclusively for major breaking architectural changes (e.g. Phase 25 Multi-Agent protocol). |
| **Novelty Documentation** | Active in `PROGRESS.md` | Documented per completed phase without blocking incremental bug fixes. |
