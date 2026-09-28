# Phase 32 — Code Intelligence Integrity

> **Version:** v1.5.0 → v1.6.0  
> **Date:** 2026-09-28  
> **Author:** Chief Engineer  
> **Core Mandate:** *"We are not making some cheap copy here; we are building frontier coding tools."*  
> **Status:** ACTIVE  
> **Scope:** Make the code-intelligence surface tell the truth. An agent that asks `find_symbol` a question and gets a confident empty answer will write code against a symbol that does not exist, or duplicate one that does. Every language the tool advertises must be extracted, and every symbol it returns must exist in the file it names.

---

## 1. Why this phase exists

Phase 30 built the semantic code graph (16 tools, workspace symbol index, LSP sensor). It worked, and it was verified — but verification concentrated on TypeScript, and the parser underneath had never been probed with ordinary code in the other languages it claims.

This phase opened with a probe, not an assumption. `packages/core/src/ast/parser.ts` was run against a handful of realistic files per language, and the probe found six defects. Four of them were the kind that destroy trust silently:

| # | Defect | What an agent actually experienced |
| :-- | :--- | :--- |
| 1 | `go` was routed to the TypeScript parser's `default` branch — no Go parser existed at all | `.go` files were walked and indexed, and `find_symbol` returned **nothing** for every function, method, type, const and var, while `AstSymbolKind` and the tool's own `kind` enum already advertised `struct`/`trait` |
| 2 | Rust `enum`, `mod`, `impl`, `type`, `const`, `static`, `union` were not extracted, and `impl` methods were emitted as top-level `function` | `AstSymbolKind` already declared `"impl"` and `"module"`; the type contract anticipated them, the implementation never landed. `find_symbol` could not find a Rust method under its type |
| 3 | A block comment's interior was scanned as code | Commented-out code became a **phantom symbol** — `find_symbol` returned a function no file contains |
| 4 | Python triple-quoted strings were not masked | A `def` or `class` written inside a module docstring or a template constant became a phantom symbol |
| 5 | A nested Python class was dropped from the index entirely | `class Inner:` inside `class Outer:` was invisible — the scan looked only for `def` and the outer loop then skipped the body |
| 6 | A `{` inside a template literal inflated brace depth | A CSS-in-JS block made the scanner run past a function's real closing brace — wrong `endLine`, or every later declaration swallowed |

Note on method: an earlier probe of this same file was **invalid** and its conclusions were discarded. Every case in it was named `.ts`, so the Python, Rust and Go rows were all parsed by the TypeScript parser. The probe was re-run with correct extensions before anything was concluded. Probe with the real input or the probe lies.

---

## 2. Wave sequence

| Task | Focus Area | Impact | Priority | Status |
| :--- | :--- | :--- | :---: | :---: |
| **32.1** | Go parser (`parseGo`) — funcs, receiver methods, structs, interfaces, aliases, `const`/`var`, grouped blocks, uppercase export rule | A whole advertised language returned zero symbols | **P0** | **COMPLETE** |
| **32.2** | Rust declaration coverage — `enum`, `mod`, `impl`, `type`, `const`, `static`, `union`; `impl` methods nested as `method` | `find_symbol` could not locate a Rust method under its type | **P0** | **COMPLETE** |
| **32.3** | Comment / template / docstring masking (`buildCodeLineMask`, `buildPythonCodeLineMask`) feeding both symbol detection and brace matching | Phantom symbols and desynchronised brace scanning | **P0** | **COMPLETE** |
| **32.4** | Python nested-class collection | Nested classes absent from the index | **P1** | **COMPLETE** |
| **32.5** | Deterministic ranked `find_symbol` + Windows-safe path canonicalization | Same query, different answer per machine; duplicate index entries on Windows | **P1** | **COMPLETE** |
| **32.6** | Remaining extraction surfaces — Rust enum variants and trait methods, Go interface method sets, TS class arrow properties, raw-string literals in Rust/Go | Known gaps, honestly declared rather than claimed as covered | **P2** | **PENDING** |
| **32.7** | `AstSymbolKind` coverage guard — a test asserting every kind the tool advertises can actually be produced by the parser | Makes defect class #1/#2 mechanical instead of discovered | **P1** | **COMPLETE** |
| **32.8** | Guardian gate, docs sync, record | — | **P0** | **IN PROGRESS** |

---

### 32.7 — Symbol kind contract guard

`packages/core/src/ast/__tests__/symbolKindContract.test.ts` reads the `kind` filter's
advertised enum straight out of `find_symbol`'s shipped `definition` (never a hardcoded
copy) and asserts it equals the set of kinds the parser really emits across a four-language
corpus. The expected set is typed `Record<AstSymbolKind, true>`, so adding a kind to the
union without covering it here is a **type error** rather than a silent gap.

It paid for itself on first run: it failed with `find_symbol cannot filter by: impl, module`
— two kinds the index could hold and return but the model had no way to filter for. `impl`
and `module` were added to the advertised enum to fix it. Three assertions:

1. the advertised enum is exactly the set of kinds the index can hold (both directions),
2. every advertised kind is producible by a supported language's parser,
3. no declared kind is silently dropped by the corpus.

## 3. Acceptance

- Every test added by this phase must be shown to **fail against the pre-change code** (stash the source, run the suite, confirm the failure, restore). A test that passes on both sides proves nothing and was treated as no evidence.
- No advertised capability may be silently unimplemented: if `detectLanguage` recognises a language, or the indexer walks an extension, or the tool advertises a `kind`, a parser must be able to produce it — or the claim is removed.
- Full gate green (Steps 0–5) before any task is called complete.

## 4. Evidence at phase open

- Probe over `packages/core/dist/ast/parser.js` (built from the live tree), one realistic file per language, extensions matched to the language.
- Mutation check via `git stash push -- packages/core/src/ast/parser.ts`: **11 of 11 new tests fail** against the old parser while all 6 pre-existing parser tests pass on both sides.
- Suite totals at close of 32.5: 176 files, **1,249 tests** (cli 117 · core 802 · tui 330); full gate Steps 0–5 green, 25/25 mock evals.
