# Current Focus — standing state

> **Status:** ACTIVE (standing) — this doc is the docs index's Current-work row:
> what is true right now, kept current alongside any open phase, and what
> reopens work.

## Where the project stands (2026-09-29)

- **Phase 38 is OPEN** (2026-09-29) — the frontier agent brain. The founding
  probe found that the eval lane assembled a **different agent than the one
  that ships**: its own system prompt, half the output budget, and
  `autoVerify: false`. Every score on record — including Phase 37's live
  24/25 — described a configuration no user ever runs. Wave 1 (38.1) landed:
  one `buildAnvilAgentProfile` owner for prompt, budget, and verify flag, with
  a fail-first parity guard (4/4 assertions failed against the pre-change call
  sites, 4/4 pass after). **The prompt rewrite (38.2) is deliberately blocked
  on the A/B harness (38.3)** — a better prompt that nothing can measure is the
  exact defect class this phase exists to close. Read
  [`PHASE-38-ROADMAP.md`](PHASE-38-ROADMAP.md); its §4 lists four boundaries,
  including the one 38.1 created and did not fix.
- The instruction layer driving an otherwise frontier-grade agent is eleven
  words: `"You are Anvil, a terminal coding agent. Be concise."` — no tool-use
  policy, no search-before-edit discipline, no verification expectation. Wave 2
  probed the reasoning and caching layers live and **corrected two hypotheses**:
  - **Gemini under-reports output tokens by up to 328×** — `thoughtsTokenCount`
    (327) is discarded while `candidatesTokenCount` (1) is recorded alone, so
    `/context` and compaction are working from a wrong number on the default
    free model. (An earlier hypothesis that reasoning text *leaked* into the
    answer was **disproved** — the SDK strips thought parts by default.)
  - **The OpenAI-style path discards live reasoning** — 2,026 characters of
    `delta.reasoning` per turn against a 68-character answer, with
    `reasoning_tokens` (80% of output) and `cached_tokens` (a measured 75% hit
    rate) both dropped.
  - **The request prefix is 4,177 tokens — 4.1× the Anthropic cache minimum**,
    re-sent every assistant round. It is already being cache-hit and is being
    accounted for at full price.
  - **Two shipped models 403 for every user.** `thinkingmachines/inkling:free`
    and `inkling-small:free` are in the picker labelled `certified: "live"`,
    recorded from a **mock** run. Verified with Anvil's exact headers.
  Receipts and the corrected ranking: [`PHASE-38-ROADMAP.md`](PHASE-38-ROADMAP.md) §1.
- Phase 37 landed (2026-09-28): the Phase 36 §4 trigger fired — a
  non-excluded Rust build tree put 402 generated symbols into a fixture index,
  so `target`, `vendor`, `__pycache__`, `.venv`, and `venv` are now excluded
  from every walk (fail-first test + mutation receipt). Two receipts recorded
  alongside it: the first full live lane (`inception/mercury-2.5`,
  **24/25 = 96%**, $0.00) and a demonstrated parallel team write collision
  (both members told ok, one content survived) — the collision is declared
  with options, not patched.
- Phase 36 landed (2026-09-28): two live-probe defects fixed — the symbol scanner
  masked every declaration after a regex literal holding a backtick, and
  window-less quota exhaustion stalled turns for their full budget instead of
  failing fast. Receipts in [`PHASE-36-ROADMAP.md`](PHASE-36-ROADMAP.md).
- Phases 32–35 landed: the code-intelligence surface tells the truth (per-language
  extraction, kind contract, freshness incl. externally added files), team runs
  stream per-tool, and every self-claim in the README and TUI is derived or
  verified. Measured state: 1,276 tests across 177 files, full gate Steps 0–5
  green, 25/25 mock evals.
- The tokeniser decision is taken: DEFER, with written adoption triggers in
  [`PHASE-35-ROADMAP.md`](PHASE-35-ROADMAP.md) §35.3. That deferral stands: no
  successor to Phase 37 was declared from it, because the backlog of declared
  code-intelligence boundaries was empty. Phase 38 was opened by a **different**
  receipt entirely (measurement validity, §Probe G above), not by the tokeniser
  backlog.

## What reopens work (the standing triggers)

Phase 38 is the active phase — the next move is **38.3, the A/B harness**, which
unblocks 38.2. These triggers still stand alongside it:

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
