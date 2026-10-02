# Current Focus — standing state

> **Status:** ACTIVE (standing) — this doc is the docs index's Current-work row:
> what is true right now, kept current alongside any open phase, and what
> reopens work.

## Where the project stands (2026-10-02)

- **Phase 39 is OPEN** (2026-09-30) — remediation of the full-tree adversarial
  audit [`AUDIT-2026-09-30.md`](AUDIT-2026-09-30.md) (79 findings). **W1–W7
  have landed**: W1 (measurement integrity) with a 10/10 fail-first receipt;
  W2 (trust exits and consent: G4 exit-4, C2 hedge, C3 cancel-130, C4
  crash≠cancel, C7 pathspec commits, F1/F2 sanitizing) with a 17/17
  fail-first receipt; W3 (gate and infra integrity, protected-artifact path);
  W4 (D1a–f parser six-pack, D2 named failsafe helpers, E3/E10 LSP freshness);
  W5 (E1/E2 bash containment, C5/C6 guardian write-back + resolvable auto-fix,
  C8 memory preamble, E6 MCP POST JSON-RPC errors); W6 (F3 member ids, F5
  cell-width, F6 diff floor, F4/F7/F9/F10/F11); W7 (B3 usage-on-error, B4
  strict pricing, A7 interleaved arms, B8 untested badge — **A8 deferred**,
  needs a structured runner error code). **W8 is partial**: E8, G17, and the G9/G13/G15 quick wins landed (derived `--help` command line, loud eval flags, interpolated p95); **G10/G11/G12 (CLI truth), F12 (dead exports), F13 (catch comments) landed 2026-10-02**, plus E9 (tree-kill parity + truncation honesty), the E8 remainder, and E7's duplicate bounds**;
  **E7 (all flagged literals centralized), C9–C19 (the whole consistency sweep), F8 (recall double-record) and G6 (docs count/version drift) also landed 2026-10-02**; H1 stays open. The W4–W8
  commits carried no bookkeeping; the 2026-10-02 reconciliation sweep verified
  their claims against live code and repaired the record (see PROGRESS.md).
  Roadmap: [`PHASE-39-ROADMAP.md`](PHASE-39-ROADMAP.md).
- **Phase 38 is OPEN** (2026-09-29) — the frontier agent brain. The founding
  probe found that the eval lane assembled a **different agent than the one
  that ships**: its own system prompt, half the output budget, and
  `autoVerify: false`. Every score on record — including Phase 37's live
  24/25 — described a configuration no user ever runs. Wave 1 (38.1) landed:
  one `buildAnvilAgentProfile` owner for prompt, budget, and verify flag, with
  a fail-first parity guard (4/4 assertions failed against the pre-change call
  sites, 4/4 pass after). The A/B harness (38.4) and per-task significance
  landed 2026-09-30, and the audit's closure fixes for them are Phase 39 W1
  (above). **The prompt rewrite (38.5) has been measured twice and is NOT
  landed**: lane A was throttled out from under the experiment (22 of 30 runs
  died at the 120s timeout, one HTTP 429) and lane B, which completed, showed
  both arms at 100% with the candidate spending one more tool call (7.5 vs 6.5)
  — no benefit, small cost. **38.6, 38.7 and
  38.8 landed 2026-10-03**: reasoning deltas are a first-class `StreamEvent`
  (shown under `/expand`, never folded into history), the static 4,177-token
  prefix now carries a `cache_control` breakpoint, and the `autoVerify: false`
  boundary has data — the same repairable failure grades FAIL with verification
  off and PASS with it on. Read
  [`PHASE-38-ROADMAP.md`](PHASE-38-ROADMAP.md); its §4 lists the boundaries,
  including the one 38.1 created and the two 38.5's receipt attempt added.
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
  verified. Measured state: 1,417 tests across 189 files, full gate Steps 0–5
  green, 25/25 mock evals.
- The tokeniser decision is taken: DEFER, with written adoption triggers in
  [`PHASE-35-ROADMAP.md`](PHASE-35-ROADMAP.md) §35.3. That deferral stands: no
  successor to Phase 37 was declared from it, because the backlog of declared
  code-intelligence boundaries was empty. Phase 38 was opened by a **different**
  receipt entirely (measurement validity, §Probe G above), not by the tokeniser
  backlog.

## What reopens work (the standing triggers)

Two phases are open. The active remediation wave is **Phase 39** (W8 remainder
next: H1 scanner coverage, C9–C19, E7/E9, F8, G6-remainder).
The scanner trigger assessment is due: AUDIT D1 was the 4th lexical patch
family for Rust/TS and W4 has now landed — re-assess below. **Phase 38.5** (the prompt rewrite)
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
