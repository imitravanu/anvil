# Current Focus — standing state

> **Status:** ACTIVE (standing) — this doc is the docs index's Current-work row:
> what is true right now, kept current alongside any open phase, and what
> reopens work.

## Where the project stands (2026-10-01)

- **Phase 39 is OPEN** (2026-09-30) — remediation of the full-tree adversarial
  audit [`AUDIT-2026-09-30.md`](AUDIT-2026-09-30.md) (79 findings). Wave 1
  landed today: A/B budget parity (A1), honest split-win significance (A2),
  live pacing (A3), one shared task filter (A5), a seam-observing test (A6),
  fail-closed certification provenance (B1), and the prototype-key log level
  (G14) — 10/10 fail-first on the mutation check. Workstreams W3–W8 remain
  open (W2 — trust exits and consent — landed 2026-10-01: headless denial
  exit 4, cancelled goals 130, subagent crash reasons, pathspec-scoped
  commits, sanitized consent/input; 17/17 fail-first); W3 touches protected
  artifacts. Roadmap:
  [`PHASE-39-ROADMAP.md`](PHASE-39-ROADMAP.md).
- **Phase 38 is OPEN** (2026-09-29) — the frontier agent brain. The founding
  probe found that the eval lane assembled a **different agent than the one
  that ships**: its own system prompt, half the output budget, and
  `autoVerify: false`. Every score on record — including Phase 37's live
  24/25 — described a configuration no user ever runs. Wave 1 (38.1) landed:
  one `buildAnvilAgentProfile` owner for prompt, budget, and verify flag, with
  a fail-first parity guard (4/4 assertions failed against the pre-change call
  sites, 4/4 pass after). The A/B harness (38.4) and per-task significance
  landed 2026-09-30, and the audit's closure fixes for them are Phase 39 W1
  (above). **The prompt rewrite (38.5) is unblocked** — a better prompt that
  nothing could measure was the defect class this phase exists to close, and
  it is closed. Read
  [`PHASE-38-ROADMAP.md`](PHASE-38-ROADMAP.md); its §4 lists eleven boundaries,
  including the one 38.1 created and did not fix.
- The instruction layer driving an otherwise frontier-grade agent is eleven
  words: `"You are Anvil, a terminal coding agent. Be concise."` — no tool-use
  policy, no search-before-edit discipline, no verification expectation. Wave 2
  probed the reasoning and caching layers live and **corrected two hypotheses**:
  - **Gemini under-reported output tokens by up to 328×** — `thoughtsTokenCount`
    (327) was discarded while `candidatesTokenCount` (1) was recorded alone, so
    `/context` and compaction worked from a wrong number on the default free
    model. **FIXED by 38.2**, with the opposite-direction trap: reasoning is now
    *summed* on Gemini and deliberately *not* added on the OpenAI wire format,
    which already includes it — one "add it everywhere" change would have fixed
    Gemini and broken 9 providers. (An earlier hypothesis that reasoning text
    *leaked* into the answer was **disproved** — the SDK strips thought parts by
    default.)
  - **The OpenAI-style path discarded live reasoning** — 2,026 characters of
    `delta.reasoning` per turn against a 68-character answer, with
    `reasoning_tokens` (80% of output) and `cached_tokens` (a measured 75% hit
    rate) both dropped. **Accounting FIXED by 38.2**; the reasoning *text* is
    still generated and thrown away (38.6).
  - **The request prefix is 4,177 tokens — 4.1× the Anthropic cache minimum**,
    re-sent every assistant round. The hit rate is now *visible* (38.2) but the
    cache is still not *requested* — there is no `cache_control` anywhere, so
    this is still being paid for as though no cache existed (38.7).
  - **Two shipped models 403 for every user.** `thinkingmachines/inkling:free`
    and `inkling-small:free` were in the picker labelled `certified: "live"`,
    recorded from a **mock** run. Verified with Anvil's exact headers.
    **FIXED by 38.3** — both are now `broken` with live provenance, kept listed
    rather than deleted so the observation survives a future sync. **Boundary:**
    43 other mock-certified rows remain unverified; the picker already labels
    them `[✅ mock]`, and a full live sweep is out of scope here.
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

Two phases are open. The active remediation wave is **Phase 39** (W3–W8 next;
W4's parser six-pack may trip the scanner trigger below — AUDIT D1 is already
the 4th lexical patch family for Rust/TS). **Phase 38.5** (the prompt rewrite)
is unblocked: after W1 the harness measures the agent it scores. These
triggers still stand:

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
