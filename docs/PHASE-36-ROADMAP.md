# Phase 36 — Scanner Truth on Real Code & Provider-Failure Honesty

> **Version:** v1.9.0 → v1.10.0
> **Date:** 2026-09-28
> **Author:** Chief Engineer
> **Core Mandate:** *"We are not making some cheap copy here; we are building frontier coding tools."*
> **Status:** COMPLETE (2026-09-28) — both defects fixed with fail-first tests; gate
> Steps 0–5 green (1,281 tests, 25/25 evals); §4 boundaries recorded, not hidden.
> **Scope:** Opened by probe evidence, not by roadmap appetite. Two live probes against
> shipped surfaces found two defects the mock lane can never see; this phase fixes both.

---

## 1. What the probes found (receipts before scope)

All three probes ran on 2026-09-28 against the live tree at `93c55f0`, gate-verified
green (1,276 tests / 177 files, 25/25 mock evals) *before* any change.

**Probe A — `find_symbol` on this repo (real code, real index):**

- `WorkspaceSymbolIndex` over this monorepo (258 ms, 1,650 symbols) returns **zero
  hits for `isReadOnlyCommand`** — an exported function at `bash.ts:289` — while
  `AgentSession`, `validateFreshness`, and `TOOL_DEFINITIONS` all resolve.
- Isolated to the line mask: `const M = /[a\`b]/;` followed by a function hides that
  function. The scanner treats a backtick inside a **regex literal** as a template
  opener; every line until the next backtick (often EOF) is masked as non-code.
- In `bash.ts` the trigger is its own safety regex: `` /[|;&<>()`$\\\n]/ `` (line 278).
  The file's second half — including `isReadOnlyCommand` — is invisible to
  `find_symbol` and `get_outline` today.
- Rust control on the same probe: `gst-plugins-rs` (17,848 symbols, 1.17 s build,
  ~101 ms per-lookup freshness) resolves every anchored symbol correctly.

**Probe B — live eval lane, `gemini/gemini-3.6-flash`:**

- `--filter diagnose`: 0/5, including a 120.10 s timeout with **0 tool calls**.
- `--filter bugfix`: 0/5 — four of the five runs hit the full 120 s timeout with
  **0 tool calls** (the pre-fix lane's final state).
- Raw provider probe shows the true cause: `You exceeded your current quota …
  free_tier_requests, limit: 20` — a DAILY cap, stated cleanly by the provider.
- The defect is Anvil-side: `isRateLimitMessage` matches `quota`, so the session
  waits (`DEFAULT_RETRY_WAIT_S` 20 s, doubling per consecutive failure, capped 120 s)
  and retries a request that cannot succeed. A hard quota becomes a silent stall.

**Probe C — contrast lane, `inception/mercury-2.5`:**

- Same harness, task 21: **PASS** in 15.5 s (9 tools, 42.6k in / 2.3k out).
- Conclusion: the loop and harness are live-healthy; Probe B is a
  failure-handling defect, not a model-quality collapse. Both findings are
  invisible to the mock lane by construction.

## 2. Wave sequence

| Task | Focus Area | Impact | Priority | Status |
| :--- | :--- | :--- | :---: | :---: |
| **36.1** | Regex-literal awareness in the TS/JS line mask and brace counter: a backtick inside a regex must never open template state; declarations after such a line stay indexed | Probe A | **P1** | **COMPLETE** |
| **36.2** | Provider-failure honesty: hard quota exhaustion (no provider retry hint) fails fast with the provider's message; genuine 429s keep the once-per-turn retry | Probe B | **P1** | **COMPLETE** |
| **36.3** | Guardian gate, docs sync, record | — | **P0** | **COMPLETE** |

## 3. Task detail

### 36.1 — A regex literal is a token, not text

Regex literals are single-line by language definition, so the line scanner can skip
them with no cross-line state — the same discipline that makes the existing
template/block-comment handling correct. The skip applies only where regex literals
exist (TS/JS); Python/Rust/Go masks are untouched. Division is not mistaken for a
regex (the standard expression-position heuristic), and an unterminated `/` is left
alone. Tests must fail against the pre-change parser: the reproduced miss, plus a
function whose *parameter list* holds such a regex (the `findMatchingBrace` half).

### 36.2 — A daily quota is not a rate limit

`isRateLimitMessage` staying true for quota messages is correct for health
bookkeeping (`noteRateLimited`/`recordFailure` still fire). What changes: a message
that says the account quota is exhausted **and advertises no retry window** is
terminal for the turn — surface it immediately. A provider that explicitly says
"retry in 13s" is claiming the condition is time-bounded; that keeps the transient
path (and its existing tests) intact.

### 36.3 — Gate, docs, record

Full gate Steps 0–5, CHANGELOG entry, docs index sync, PROGRESS flip to DONE with
receipts (including a live re-run of Probe B showing fast, explicit quota failures
instead of 120 s stalls).

## 4. Declared boundaries (recorded, not hidden)

- **Free-tier quota is an environment limit, not something code can fix.** With
  gemini's daily free quota exhausted, live lanes on that provider cannot produce
  quality signal today; the fix makes that state loud and fast instead of silent.
- **Parallel team members share a filesystem** (`team/runner.ts` states it
  deliberately). Worktree isolation for mutating parallel members is NOT in this
  phase; it reopens when a probe shows a collision in real use.
- **`EXCLUDED_DIRS` has no Rust `target/`, Go `vendor/`, or Python `.venv`/`__pycache__`.**
  The Rust probe repo had no `target/` dir, so no live cost was measured; recorded
  as a boundary to close when a probe shows one (a built Rust repo is the trigger).
- **The mock lane measures the scripted provider, not a model.** Every defect this
  phase found required a live probe; the eval harness now counts provider-error
  failures distinctly from test failures is NOT in scope — recorded for a future
  phase if it proves load-bearing.

## 5. Method (unchanged, it keeps proving itself)

Probe before believing; a test counts as evidence only if it fails against the
pre-change code; read the existing harness before writing new tests; measure,
never infer, a number; declare what remains open rather than implying it is
handled.
