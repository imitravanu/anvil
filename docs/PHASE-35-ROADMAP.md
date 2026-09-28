# Phase 35 — Closing the Declared Boundaries

> **Version:** v1.8.0 → v1.9.0  
> **Date:** 2026-09-28  
> **Author:** Chief Engineer  
> **Core Mandate:** *"We are not making some cheap copy here; we are building frontier coding tools."*  
> **Status:** ACTIVE  
> **Scope:** Phases 32–34 each declared a boundary rather than hiding it. This phase closes those declarations: the two deferred code-intelligence gaps, and the tokeniser decision that has been recorded three times without being made.

---

## 1. The three open declarations

| # | Declared where | The boundary | Why it matters |
| :-- | :--- | :--- | :--- |
| 1 | Phase 32/33 changelogs | Externally **added** files are not discovered by `validateFreshness` — only edits and deletes of already-indexed files are repaired | After `git checkout` brings in new files, `find_symbol` says "confidently empty" for symbols that exist |
| 2 | Phase 34 roadmap | Team streaming is per-**member**; a member's internal tool-by-tool `subagent_progress` still arrives with that member's flush | A long single-member team run still shows one row with a static tool count |
| 3 | Phase 32/33 roadmaps | The parser is a line scanner; the tree-sitter trade-off is "deliberately NOT decided" | Every Phase 32 fix taught the scanner one more lexical rule; the class is narrowed, not closed |

## 2. Wave sequence

| Task | Focus Area | Impact | Priority | Status |
| :--- | :--- | :--- | :---: | :---: |
| **35.1** | Addition discovery: a cheap root-level liveness check (e.g. directory mtimes or a bounded walk when the index is stale by age) so newly added files enter the index without a full rebuild per lookup | Boundary #1 | **P1** | **COMPLETE** |
| **35.2** | Per-tool `subagent_progress` across members: yield the member's generator inside the team path instead of buffering until finish | Boundary #2 | **P1** | **COMPLETE** |
| **35.3** | The tokeniser decision: measure bundle size, startup time, and grammar-missing behaviour for a tree-sitter bridge behind `AstSymbol`; write the decision (adopt, reject, or defer with criteria) — analysis first, no code | Boundary #3 | **P2** | **PENDING** |
| **35.4** | Guardian gate, docs sync, record | — | **P0** | **PENDING** |

## 3. Method (unchanged, it keeps proving itself)

Probe before believing; a test must fail against pre-change code to count as
evidence; read the existing harness before writing new tests; when a failing test
contradicts something you "knew", print the real behaviour with a probe; declare
what remains open.
