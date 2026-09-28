# Phase 33 — Advertised Capability Audit

> **Version:** v1.6.0 → v1.7.0  
> **Date:** 2026-09-28  
> **Author:** Chief Engineer  
> **Core Mandate:** *"We are not making some cheap copy here; we are building frontier coding tools."*  
> **Status:** ACTIVE  
> **Scope:** Phase 32 fixed eleven defects that were all one shape — a claim that was not true. This phase turns that from a series of discoveries into a sweep: find every number, capability, or count the project asserts about itself, and either derive it from code or delete it.

---

## 1. Why this phase exists

`docTruth.test.ts` already guards a good set of claims (release badge, provider count,
tool count, Node badge, the certified-provider table, env vars, roadmap headers). The
gap is not the *idea*, it is the *coverage*: each guard protects the phrasing a past
session happened to notice.

The proof is small and concrete. The README's architecture box carries two counts in
adjacent lines:

```
│    Autonomous Agent Loop · Provider Adapters (12)      │   ← guarded
│    16 Built-in Tools · LSP Client · Checkpoint Ring    │   ← was NOT guarded
```

The provider count is asserted against the registry. The tool count was not, and had
silently drifted to **15** while the README's own headline and the tool registry both
said **16** — the same page contradicting itself, on the number a reader uses to judge
what the tool does.

A guard per discovered instance is whack-a-mole. This phase sweeps the class.

---

## 2. Wave sequence

| Task | Focus Area | Impact | Priority | Status |
| :--- | :--- | :--- | :---: | :---: |
| **33.1** | README architecture-box tool count corrected (15 → 16) and guarded against the tool registry | A number stated two ways on one page, one of them wrong | **P0** | **COMPLETE** |
| **33.2** | Sweep README, `docs/README.md` and the TUI for every remaining hand-written count or capability claim, and classify each: derived-from-code / correct-but-unguarded / false | Finds the rest of the class instead of waiting for the next one | **P0** | **PENDING** |
| **33.3** | For each correct-but-unguarded claim, add a derived assertion to `docTruth.test.ts`; for each false claim, fix it or delete it | Makes the sweep mechanical and permanent | **P1** | **PENDING** |
| **33.4** | Check the TUI's advertised capability surfaces (command palette entries, the empty-state capability pill, `/help` output) against what the handlers actually support | These are read by every user on launch and are not covered by any truth guard | **P1** | **PENDING** |
| **33.5** | Guardian gate, docs sync, record | — | **P0** | **IN PROGRESS** |

---

## 3. Method (inherited from Phase 32, and it is the point)

1. **Probe, do not read.** Every Phase 32 defect was found by running the code against
   ordinary input, not by inspecting it. A claim is verified by executing the thing
   that backs it.
2. **Discard an invalid probe.** One probe of mine concluded the Python and Rust
   parsers were broken when every case had been named `.ts`, so all of it was parsed by
   the TypeScript parser. Re-run with the real input before trusting any conclusion.
3. **A test that passes on both sides proves nothing.** Each new test must be shown to
   fail against the pre-change code (stash the source, run, restore). Where a test
   guards *new* code against over-matching rather than reproducing an old bug, say so
   explicitly instead of presenting it as bug-fix evidence.
4. **Declare what is left open.** Phase 32 declared 32.9 when it found the multi-line
   raw-string gap, then closed it. Gaps get recorded where they are found.

## 4. Standing architectural question (not decided here)

The parser is a line-oriented scanner. Every Phase 32 fix taught it one more piece of
one more language's lexical grammar, and the class is *narrowed but not closed* —
string-aware braces, lifetimes, raw strings, docstrings and commented-out code were all
the same underlying problem: no real tokeniser. A parse tree (tree-sitter, or a JS
grammar) would close the class rather than narrow it.

That is a genuine dependency decision with real cost — the CLI ships as a single
~7 MB zero-runtime-dependency bundle — and it is deliberately **not** decided in this
phase. It needs its own analysis of bundle size, startup time and failure behaviour
when a grammar is missing. Recorded here so it is a considered decision when taken,
not a surprise.
