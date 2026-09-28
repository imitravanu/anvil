# Phase 32 — Code Intelligence Integrity

> **Version:** v1.5.0 → v1.6.0  
> **Date:** 2026-09-28  
> **Author:** Chief Engineer  
> **Core Mandate:** *"We are not making some cheap copy here; we are building frontier coding tools."*  
> **Status:** COMPLETE (2026-09-28) — successor: [`PHASE-33-ROADMAP.md`](PHASE-33-ROADMAP.md)  
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
| **32.6** | Member extraction — Rust trait methods and enum variants, Go interface method sets, TS enum members, class arrow properties and abstract methods; string-aware brace counting in the Rust/Go scanners | Containers were indexed, their searchable members were not | **P0** | **COMPLETE** |
| **32.7** | `AstSymbolKind` coverage guard — a test asserting every kind the tool advertises can actually be produced by the parser | Makes defect class #1/#2 mechanical instead of discovered | **P1** | **COMPLETE** |
| **32.8** | Guardian gate, docs sync, record | — | **P0** | **COMPLETE** |
| **32.9** | Brace counting across a MULTI-LINE string literal — Go's backtick form is covered by the code mask, a multi-line Rust raw string (`r#"…` opened on one line and closed on another) is not | Narrow remaining gap in the same class as 32.6 | **P2** | **COMPLETE** |

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

### 32.6 — Member extraction and string-aware braces

Two defects of the same shape: a container was indexed while the things declared
*inside* it were not, and a scanner counted characters that were not syntax.

**Members.** Rust trait methods (`fn run(&self);`) and enum variants, Go interface
method sets, TypeScript enum members, and callable class properties
(`onClick = () => {}`) were absent from `find_symbol`. Plain data fields are
deliberately excluded — a class field is a value, not a declaration an agent
looks up by name, and indexing them would flood the symbol table.

The tests caught two bugs in the first version of this work, both the *same* bug:
a declaration with **no body** whose scanner then adopted the next declaration's
braces. An abstract TypeScript method (`public abstract compute(): number;`) and a
signature-only Rust trait method each silently dropped the method that followed
them. Both are now guarded by detecting a signature that ends in `;`.

**Braces in strings.** Neither the Rust nor the Go scanner skipped string
literals, so one brace inside a string left depth permanently unbalanced, the real
closing brace never returned depth to zero, and the symbol's line range collapsed
to a single line. Measured before the fix: a Rust function spanning lines 1–4
reported `L1-1`, a Go function spanning 3–6 reported `L3-3`. The TypeScript
scanner was already string-aware, which is why only these two languages were
affected. Rust lifetimes (`&'a str`) are matched precisely so they are not read as
char literals.

### 32.9 — Multi-line string literals

The code mask already carried block-comment and template state across lines, but
a Rust raw string uses `r#"…"#` and has no escapes, so its interior was still
scanned as code: a stray `{` inside one inflated brace depth and collapsed the
enclosing declaration's line range (a function spanning lines 1-6 reported `L1-1`).
`buildCodeLineMask` now takes a `rustRawStrings` option — opted into by `parseRust`
only — and carries the closing `"#` across lines the way it does block comments.
Go's backtick form was already covered.

A false-positive guard is included: an identifier merely *ending* in `r`
(`Renderer`, `first`) must not be read as a raw-string opener. That test passes with
and without the feature enabled by design — it guards the new code against
over-matching, which is a different claim from "the old code was broken" and is
labelled as such rather than presented as bug-fix evidence.

Isolated check: with the option disabled, exactly one test fails
(`expected 1 to be 6`); with it enabled, all pass.

### 32.8 — Gate, docs sync, record

- Full gate Steps 0-5 green at each of the phase's six commits; final state measured
  (not estimated) at **1,263 tests across 177 files** — cli 117/18 · core 816/103 ·
  tui 330/56 — with 25/25 mock evals and the anti-slop scanner clean. An earlier draft
  of this line said "1,284", guessed rather than counted; that is precisely the defect
  class this phase exists to remove, and it was caught by measuring before committing.
- Every task's tests were shown to fail against the pre-change code before the
  task was called done — **34 new tests**, counted rather than estimated (parser
  suite +22, symbol index 9, symbol-kind contract 3).
- **Correction, 2026-09-28:** this line and the commit message of `379e1d5`
  initially said "36 new tests". That number was written from memory and is wrong;
  34 is the measured figure. It is recorded here rather than silently overwritten
  because inventing a statistic while closing a phase whose entire subject is
  unverified self-claims is the exact failure this phase exists to remove — the
  count was caught only because it was double-checked before being trusted.
- Both newly-found gaps during the phase were recorded where they were found
  (32.9 declared open in 32.6 and then closed here) rather than quietly dropped.

## 3. Acceptance

- Every test added by this phase must be shown to **fail against the pre-change code** (stash the source, run the suite, confirm the failure, restore). A test that passes on both sides proves nothing and was treated as no evidence.
- No advertised capability may be silently unimplemented: if `detectLanguage` recognises a language, or the indexer walks an extension, or the tool advertises a `kind`, a parser must be able to produce it — or the claim is removed.
- Full gate green (Steps 0–5) before any task is called complete.

## 4. Evidence at phase open

- Probe over `packages/core/dist/ast/parser.js` (built from the live tree), one realistic file per language, extensions matched to the language.
- Mutation check via `git stash push -- packages/core/src/ast/parser.ts`: **11 of 11 new tests fail** against the old parser while all 6 pre-existing parser tests pass on both sides.
### Result

Eleven defects across three commits, every one of them the same shape: **a claim
that was not true** — an advertised language with no parser, an advertised kind
filter that could not express two kinds, containers indexed without their members,
and three ways the scanner counted characters that were not syntax. None were
found by reading the code; all were found by running it against ordinary input, and
one of my own probes was invalid before it produced any of them.

The parser is still a line-oriented scanner, and that is the structural ceiling
behind this whole class: each fix teaches it one more piece of one more language's
lexical grammar. A real parse tree would close the class rather than narrow it —
that trade-off (a parser dependency against a zero-dep bundle) is deliberately NOT
decided here and belongs to a future phase with its own analysis.
