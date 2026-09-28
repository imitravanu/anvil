# Phase 35 — Closing the Declared Boundaries

> **Version:** v1.8.0 → v1.9.0  
> **Date:** 2026-09-28  
> **Author:** Chief Engineer  
> **Core Mandate:** *"We are not making some cheap copy here; we are building frontier coding tools."*  
> **Status:** COMPLETE (2026-09-28) — all three declared boundaries closed; no successor declared, the next phase opens when evidence defines it  
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
| **35.3** | The tokeniser decision: measure bundle size, startup time, and grammar-missing behaviour for a tree-sitter bridge behind `AstSymbol`; write the decision (adopt, reject, or defer with criteria) — analysis first, no code | Boundary #3 | **P2** | **COMPLETE (decision: DEFER, with written adoption triggers)** |
| **35.4** | Guardian gate, docs sync, record | — | **P0** | **COMPLETE** |

### 35.3 — The tokeniser decision: DEFER, with triggers

**Measured baseline (this repo, 2026-09-28, `npm run measure:startup`):**

| Metric | Value |
| :-- | :-- |
| CLI bundle (`dist/index.js`) | 7.17 MB, **zero runtime dependencies** |
| Startup (`anvil --version`, median of 10) | ~390 ms |
| Scanner engine | 1,333 lines, line-oriented, hardened by 34+ tests this session |

**Cost of a tree-sitter bridge** (from a published integration spike of the same
choice — web-tree-sitter 0.25.x + prebuilt grammar WASMs, blamechris.com
repo-memory design doc, independently gathered, not from memory):

| Metric | Value |
| :-- | :-- |
| Runtime (`web-tree-sitter`) | ~5.8 MB unpacked |
| Grammars (typescript, tsx, javascript, python, go, rust) | ~10–12 MB unpacked |
| One-time WASM startup (init + grammar load + first parse) | 12–14 ms (~3.5% of Anvil's 390 ms) |
| Parse cost | ~0.5 ms/file (~30x the regex approach; a full re-index adds hundreds of ms on this repo's size) |
| Known footgun | `web-tree-sitter` 0.26.x rejects the grammar binaries of current grammar packs — a version-pinning trap |
| Memory | WASM-heap per tree; long-lived processes need explicit `tree.delete()` |

**The decision: DEFER.** The reasoning is the session's own method applied to
itself: every code-intelligence fix since Phase 32 was driven by a failing probe,
and **there is no failing probe today that a real parser would fix.** All eleven
Phase 32 defects are fixed and guarded; freshness is validated; the scanner's
known lexical gaps are declared. Adopting a dependency to fix hypothetical bugs
would be exactly the assumption-first work this session exists to prevent.

Two structural facts weigh against adoption *now* and are recorded so the deferral
is honest rather than timid: the single-bundle, zero-runtime-dependency CLI is a
deliberate distribution property (WASM assets would have to ship alongside it,
+~10 MB unpacked), and the version-pinning trap above is a real operational risk.
Two facts keep adoption *live* rather than dead: the `AstSymbol` interface is
already the seam a bridge would sit behind (regex scanner stays as the universal
fallback, so a bridge can never do worse), and ~3.5% startup cost is acceptable.

**Adoption triggers — any ONE of these opens the spike:**

1. A probe finds a scanner defect that materially misleads `find_symbol` in
   shipped usage, and it is the *third* patch to the same language's lexical rules
   (the signal that per-language scanner maintenance has stopped scaling).
2. A fifth language must be properly supported (new line-scanners are where this
   approach scales worst).
3. Users report `find_symbol` misses on real repos in a language the LSP sensor
   does not cover.

**Spike plan (when triggered):** bridge behind `AstSymbol` with the scanner as
fallback; vendor only the six grammars above (~10–12 MB); pin `web-tree-sitter`
to the grammar-compatible minor; wire `tree.delete()` into the index's
`removeFile`/`buildIndex`; make grammar-load failure LOUD (a one-line log, never
silent); re-run `measure:startup` and the full gate; ship behind a config flag
for one release before flipping the default.

## 4. Phase status after this phase

All three declared boundaries are closed: #1 (addition discovery) and #2 (per-tool
streaming) in code, #3 (tokeniser) by decision with triggers. **No successor phase
is declared** — the backlog of declared boundaries is empty. The next phase opens
when a probe, a user need, or one of the three triggers above defines it; a
manufactured roadmap would be the documentation bloat the constitution forbids.

## 5. Method (unchanged, it keeps proving itself)

Probe before believing; a test must fail against pre-change code to count as
evidence; read the existing harness before writing new tests; when a failing test
contradicts something you "knew", print the real behaviour with a probe; declare
what remains open.
