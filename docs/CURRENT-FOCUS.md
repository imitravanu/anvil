# Current Focus — standing state

> **Status:** ACTIVE (standing) — this doc is the docs index's Current-work row
> while no phase is open. It is deliberately small: what is true right now, and
> what reopens work.

## Where the project stands (2026-09-28)

- Phases 32–35 landed: the code-intelligence surface tells the truth (per-language
  extraction, kind contract, freshness incl. externally added files), team runs
  stream per-tool, and every self-claim in the README and TUI is derived or
  verified. Measured state: 1,276 tests across 177 files, full gate Steps 0–5
  green, 25/25 mock evals.
- The tokeniser decision is taken: DEFER, with written adoption triggers in
  [`PHASE-35-ROADMAP.md`](PHASE-35-ROADMAP.md) §35.3. No successor phase was
  declared because the backlog of declared boundaries is empty.

## What reopens work (the standing triggers)

1. **Scanner trigger** — a probe finds a parser defect that materially misleads
   `find_symbol` in shipped usage and it is the third patch to the same language's
   lexical rules → open the tree-sitter spike per the Phase 35 plan.
2. **Language trigger** — proper support for a fifth language is needed → same.
3. **User trigger** — reports of `find_symbol` misses on real repos in a language
   the LSP sensor does not cover → same.
4. **Anything else** — a probe, a bug report, or a user need defines the next
   phase's scope. Manufactured roadmaps are documentation bloat; evidence is not.

## Rules that outlive phases

- Probe before believing; discard an invalid probe rather than reason from it.
- A test counts as evidence only if it fails against the pre-change code.
- Read the existing harness before writing new tests; measure, never infer a
  number; declare what remains open rather than implying it is handled.
