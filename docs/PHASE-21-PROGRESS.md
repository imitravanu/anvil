# Phase 21: Security Hardening (v0.9.0) Progress Report

> **Date:** 2026-09-13  
> **Status:** COMPLETED  
> **Version:** 0.8.0 → 0.9.0  
> **Branch:** master  
> **Chief Engineer:** Antigravity  

---

## 1. Executive Summary

Phase 21 hardens Anvil's tool execution sandbox, closing three security vectors before progressing to logic bugs and stability sweeps in Phases 22–24. Following Standing Rule 7.8 and the Pre-Execution Audit protocol, dedicated failing tests were authored first, proving vulnerability presence, before implementing targeted minimal patches and verifying all gates.

Key deliverables completed in Phase 21:

1. **21.1 — Shell Quote Path Traversal Bypass in `run_command` (`packages/core/src/tools/bash.ts`):**
   - Added `stripShellQuotes` to normalize outer matching single and double quotes.
   - Enforced rejection of arguments with residual unclosed/internal shell quotes.
   - Closed bypass where `cat "/etc/passwd"` previously bypassed the read-only whitelist permission prompt.
2. **21.2 — Destructive System Directory Wipe Protection (`packages/core/src/tools/bash.ts`):**
   - Expanded `isRootWipe` heuristics to match and refuse recursive deletions targeting top-level system paths (`/usr`, `/etc`, `/var`, `/dev`, `/boot`, `/lib`, `/lib64`, `/bin`, `/sbin`, `/opt`, `/proc`, `/sys`, `/run`, `/srv`, `/tmp`, `/root`, `/mnt`, `/media`).
   - Protects both interactive sessions and auto-approve / headless runs (`-y` / `--yes`).
3. **21.3 — Test Runner Flag Injection Guard (`packages/core/src/tools/verifyTests.ts`):**
   - Sanitized `argvWithPattern` to reject patterns starting with `-` or containing null bytes (`\0`).
   - Exported `argvWithPattern` for direct assertion; prevents model inputs like `--pastebin` or `-j1` from being interpreted as CLI flags by `pytest` or `cargo test`.
4. **Version Bump & Distribution Alignment:**
   - `CORE_VERSION` bumped to `0.9.0` in `packages/core/src/version.ts`.
   - Workspace packages bumped to `0.9.0` (`@anvil/core`, `@anvil/tui`, `@anvil/cli`).
   - `CHANGELOG.md` updated with `## [0.9.0]` Security section.

---

## 2. Vulnerability Details & Fix Architecture

### 21.1 Shell Quote Path Traversal Bypass

- **File:** `packages/core/src/tools/bash.ts` (`pathsInsideRoot()`)
- **Vulnerability:** `pathsInsideRoot` checked positional arguments with `path.isAbsolute(arg)` without stripping quotes. `cat "/etc/passwd"` was parsed as argument `"/etc/passwd"`. Because it began with `"`, `path.isAbsolute` evaluated to `false`, resolving it against `projectRoot` (`/project/"/etc/passwd"`), passing containment and running without prompting the user.
- **Fix:**
  ```typescript
  function stripShellQuotes(s: string): string {
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
      return s.slice(1, -1);
    }
    return s;
  }
  ```
  In `pathsInsideRoot`, quotes are stripped before checking absolute paths or resolving against root, and any residual quotes trigger containment failure.

### 21.2 Root & System Directory Wipe Protection

- **File:** `packages/core/src/tools/bash.ts` (`isRootWipe()`)
- **Vulnerability:** The previous regex `/(^|\s)(\/(\s|$|\*)|~|\$HOME|\$\{HOME\})/` only caught bare `/`, `/*`, `~`, and `$HOME`. Commands like `rm -rf /usr` or `rm -rf /etc` passed the blocker.
- **Fix:**
  ```typescript
  const SYSTEM_PATHS = /(?:^|\s)(?:\/(?:\s|$|\*)|~|\$HOME|\$\{HOME\}|\/(?:usr|etc|var|dev|boot|lib|lib64|bin|sbin|opt|proc|sys|run|srv|tmp|root|mnt|media)(?:\s|\/|$))/;
  return SYSTEM_PATHS.test(rest);
  ```

### 21.3 Test Runner Flag Injection Guard

- **File:** `packages/core/src/tools/verifyTests.ts` (`argvWithPattern()`)
- **Vulnerability:** Patterns supplied by models to `verify_tests` were appended directly to test runner arguments (`["pytest", ...rest, pattern]`), allowing CLI flag injection if the pattern began with `-`.
- **Fix:**
  ```typescript
  export function argvWithPattern(baseCommand: string, pattern: string): string[] | null {
    if (pattern.startsWith("-")) return null;
    if (pattern.includes("\0")) return null;
    // ...
  }
  ```

---

## 3. Test Evidence

### Initial TDD Failure Proof
Prior to applying code fixes, new tests in `bash.test.ts` and `verifyTests.test.ts` failed as expected:
- `cat "/etc/passwd"` returned `true` (failed containment).
- `rm -rf /usr` returned `null` (unblocked).
- `argvWithPattern("pytest", "--pastebin")` threw `TypeError` (unexported / unsanitized).

### Post-Fix Test Results
- `packages/core/src/tools/__tests__/bash.test.ts`: **18/18 passed**
- `packages/core/src/tools/__tests__/verifyTests.test.ts`: **22/22 passed**

---

## 4. Verification Gate Summary

- `npm run build`: Exit 0 (clean monorepo build)
- `npm run typecheck`: Exit 0 (zero errors across core, tui, cli)
- `npm test`: 567/567 passed
- `npm run eval -- --fast --mock`: 15/15 passed
- Guardian Gate: All quality checks satisfied.
