# PHASE 11 SPEC — Project Rules & Workspace Outline ("Codebase Intelligence v1")

> **Status:** APPROVED & IN IMPLEMENTATION (Directive: "start working", 2026-09-06)  
> **Author:** Chief Engineer  
> **Target:** Anvil v0.6.0  

---

## 0. Objective

Equip Anvil with two core capabilities that dramatically improve context relevance and reduce token spend:
1. **Automatic Project Rules Discovery (`.anvil/rules` / `AGENTS.md` / `.cursorrules`):**  
   Automatically detect workspace-level conventions, guidelines, and commands at session start and cleanly append them to the agent system prompt, allowing repos to define their own agent personas, build steps, and quality rules.
2. **Workspace Outline Tool (`get_outline`):**  
   Provide a fast, non-mutating structural inspection tool that summarizes code structure (exported functions, classes, interfaces, types) for a given file or directory, eliminating the need for models to read thousands of lines of code merely to discover symbol signatures.

---

## 1. Design & Specifications

### 1.1 Project Rules Engine (`packages/core/src/config/rules.ts`)

- **Discovery Precedence (workspace root):**
  1. `.anvil/rules`
  2. `AGENTS.md`
  3. `.cursorrules`
- **Bounds & Safety:**
  - Hard cap of 16,384 bytes (`MAX_RULES_BYTES = 16 * 1024`).
  - Oversized rule files are truncated at 16KB with `\n[rules truncated at 16KB]`.
  - Non-existent or empty files return `null` (no system prompt modification).
  - Path containment: Re-validated within project root (no symlink path escapes).
- **Format Injected into System Prompt:**
  ```
  <base system prompt>

  [Project-specific rules from <source>]
  <content>
  ```
- **Function Signatures:**
  ```typescript
  export interface ProjectRules {
    source: string; // e.g., ".anvil/rules"
    content: string;
  }

  export function loadProjectRules(projectRoot: string): ProjectRules | null;
  export function buildSystemPrompt(basePrompt: string, projectRoot: string): string;
  ```

### 1.2 Workspace Outline Tool (`packages/core/src/tools/outline.ts`)

- **Tool Definition:**
  - Name: `get_outline`
  - Description: "Inspect the structural outline (exported symbols, classes, functions, interfaces, types) of a source file or directory in the project."
  - Input Schema:
    - `path`: string (optional, defaults to project root or specified file/directory)
  - `mutating: false` (read-only, parallel-safe).
- **Parser Mechanics:**
  - High-speed regex/AST structural extractor for TypeScript, JavaScript, Python, Go, Rust, and Markdown headings.
  - Returns structured symbol signatures without loading full file bodies into conversation context.
  - Bounded output: max 100 symbols or 20KB to avoid flooding model context.

---

## 2. Non-Goals

- NO heavy external native compilation dependencies.
- NO uncontained filesystem traversals.
- NO modification to existing session persistence or checkpoint schemas.
- NO disruption to the 253 existing test suites.

---

## 3. Acceptance Criteria

- **R1:** `loadProjectRules()` discovers `.anvil/rules` first, then `AGENTS.md`, then `.cursorrules`.
- **R2:** Oversized rules files (>16KB) are truncated cleanly with a diagnostic marker.
- **R3:** `buildSystemPrompt()` leaves base prompt untouched if no rules exist.
- **R4:** `get_outline` tool returns structural signatures for supported file types.
- **R5:** `get_outline` respects path containment and rejects escapes outside project root.
- **R6:** CLI & TUI boot seamlessly loads project rules into session options.
- **R7:** 100% green test suite across `@anvil/core`, `@anvil/tui`, and `@anvil/cli`.
