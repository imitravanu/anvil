# Phase 38 — Frontier Agent Brain: measurement before prompt

> **Version:** v1.11.0 → v1.12.0
> **Date:** 2026-09-29
> **Author:** Chief Engineer
> **Core Mandate:** *"We are not making some cheap copy here; we are building frontier coding tools."*
> **Status:** IN PROGRESS — 38.1 (measurement parity) and 38.2 (token accounting)
> landed, both with fail-first mutation receipts. Wave 2 probes ran live against
> Gemini and OpenRouter and produced four receipts, two of which **corrected** an
> earlier hypothesis; the ranking below changed as a result. The prompt rewrite
> (38.5) is deliberately blocked on the A/B harness (38.4).
> **Scope:** Anvil's agent loop, guardian, compaction, rewind, LSP, and permission
> surfaces are at or past frontier engineering. The instruction layer driving all
> of it is eleven words, and the harness that is supposed to detect a bad
> instruction layer cannot fail. This phase fixes the measurement first and only
> then changes what the model is told.

---

## 1. Receipts before scope

**Probe G — the eval lane measures a different agent than the one that ships.**

The live 24/25 recorded in Phase 37 §Probe E is a score of an agent **no user
ever runs**. The eval lane assembled its own agent configuration in three
respects, none of which matched the TUI or headless:

| Input | Eval lane (pre-change) | Shipping surfaces |
| :--- | :--- | :--- |
| System prompt | `"You are Anvil, an expert coding agent. Fulfill the user request accurately."` (`eval/runner.ts:157`) | `"You are Anvil, a terminal coding agent. Be concise."` (`cli/src/index.tsx:347`, `cli/src/headless.ts:118`) |
| Output budget | `task.maxTokens \|\| 4096` | `8192` (both sites) |
| Closed-loop verify | `autoVerify: false` | `autoVerify: true` (both sites) |

So every number on record — including the 96% — describes a configuration that
was never shipped. The divergence is old enough that it is baked into the
recorded baseline.

**Probe H — the gate that gates every commit cannot observe the prompt.**

Gate Step 5 runs the mock lane. Every task in the baseline run reports **1 tool
call and 645 tokens**, identical across all 25, because
`eval/mockProvider.ts` copies `assertions/expected/` into place and never
consults the model. The mock lane is green by construction
(`.github/workflows/live-eval.yml` says so). The consequence is not a bug but a
structural limit: **a change to the system prompt cannot move the gate at all.**
`docs/ROADMAP.md:37-38` states the intent — "every change to prompts, tools, the
goal engine, or compaction runs the harness; a regression blocks the release" —
and that intent has never been met.

**Probe I — a dead export that should have surfaced the drift.**

`DEFAULT_MAX_TOKENS` (`config/constants.ts:23`) was exported with **zero
callers** while two call sites hardcoded `8192` and a third hardcoded `4096` —
a standing instance of rule 2.8 (no dead production exports). The token budget
had no owner, which is the same defect as the prompt having no owner.

**Probe J — the instruction layer itself.**

```
"You are Anvil, a terminal coding agent. Be concise."
```

Eleven words, and it is the complete instruction set for a 16-tool agent. It
states no tool-use policy, no search-before-edit discipline, no verification
expectation, and no file conventions. Cross-referenced against the Phase 37 live
failure — the model broke `tsconfig.json` after 18 tool calls — this is a
*behavioral discipline* gap, not a model-capability gap. The closed-loop
verification loop in `agent/turnVerifier.ts` is genuinely good, and nothing in
the prompt tells the model it exists.

**Corroboration that the gap is unrecorded:** a full read of all 84 files in
`docs/` found no document asking whether the base prompt is adequate. The docs
describe prompt *assembly order* (`ENGINEERING-MEMORY.md:53`,
`ANVIL-COMPLETE-ROADMAP.md:651-653`) and never prompt *content*.

### Wave 2 probes — reasoning and caching (2026-09-29, live)

Run against the live APIs with the machine's configured keys. Two of the four
probes were **discarded or corrected**; both corrections are recorded, because a
corrected probe is the receipt and a quietly-dropped one is a lie.

**Probe K — Gemini token accounting (CORRECTED; the first hypothesis was wrong).**

- K1 predicted a reasoning-text leak: that `RawGeminiChunk` has no `thought`
  field (`gemini.ts:9-14`) while `gemini.ts:73` yields every `part.text` as a
  `text_delta`, so a thinking model's private reasoning would render as the
  answer. **Disproved.** The `@google/genai` SDK strips thought parts unless
  `includeThoughts` is set, and Anvil never sets it. Measured: **0 thought
  parts** on `gemini-3.6-flash`. There is no leak, and the finding that
  motivated it is withdrawn.
- What K1 actually measured is worse. On a one-line question, usage returned
  `candidatesTokenCount: 1` alongside **`thoughtsTokenCount: 327`**. Anvil reads
  only the first (`gemini.ts:17-20`). A trivial turn is recorded as **1 output
  token when 328 were spent — a 328× undercount.**
- Full `usageMetadata` keys returned: `promptTokenCount`, `candidatesTokenCount`,
  `totalTokenCount`, `promptTokensDetails`, **`thoughtsTokenCount`**, `serviceTier`.
  Anvil reads two.
- The second probe (part shapes under `includeThoughts: true`) was cut short by
  the Gemini free tier's 20-requests-per-day cap, already spent by K1. Recorded
  as incomplete, not as a result.
- Consequence: `/context` under-reports, and the calibration loop
  (`agent/session.ts:690`) learns from a count that excludes reasoning. On a
  thinking model, compaction fires late — the opposite of the
  fail-fast intent of Phase 36.

**Probe L — the OpenAI-style path (9 of 12 providers).**

`translateChatCompletionsChunkStream` (`openai.ts:65-67`) reads only
`delta.content`. Against `openrouter/free` (a registry default):

| Field | Measured | Anvil's handling |
| :--- | ---: | :--- |
| `delta.reasoning` | **2,026 chars** | **discarded** |
| `delta.content` (the answer) | 68 chars | rendered |
| `completion_tokens` | 641 | read — **correct**, includes reasoning |
| `completion_tokens_details.reasoning_tokens` | **515** (80% of output) | discarded |
| `prompt_tokens` | 55 | read |
| `prompt_tokens_details.cached_tokens` | 0 | discarded |

- The token count on this path is **correct** — `completion_tokens` already
  includes reasoning, unlike Gemini. The asymmetry between the two adapters is
  the defect, not a shared one.
- The loss here is content, not accounting: the model emits 2,026 characters of
  deliberation and Anvil discards every byte of it. The user never sees the
  reasoning and history never stores it.
- Against `stealth/space-bunny-alpha`, `prompt_tokens_details.cached_tokens`
  was **149 of 198 prompt tokens — a 75% cache hit rate that Anvil cannot
  observe.** OpenRouter caches automatically; Anvil is already being paid for
  the cache and is accounting for it at full price.

**Probe M — the request prefix is already 4× over the cache minimum.**

Measured on this repo with the production prompt assembly
(`buildSystemPrompt` + `TOOL_DEFINITIONS`):

```
system prompt   : 2,261 tokens
tool schemas    : 1,916 tokens   (16 tools)
PREFIX TOTAL    : 4,177 tokens   re-sent on every assistant round
```

Against vendor minimums: **4.1×** Anthropic Sonnet/Opus (1,024) and OpenAI
automatic (1,024); **2.0×** Anthropic Haiku (2,048); **0.1×** Gemini implicit
(32,768 — not reachable without conversation history).

At an illustrative $3/1M input, the prefix alone costs **$2.51 over 200 rounds**
uncached versus **$0.25** cached. The multiplier is *rounds*, not turns:
`DEFAULT_MAX_INNER_ITERATIONS = 20`, so one user turn with five tool calls
re-sends it six times. Note the system prompt is 2,261 tokens and the base
prompt is eleven words — `AGENTS.md` dominates it. Whatever 38.2 writes, the
cache breakpoint belongs *before* the volatile tail, and a longer behavioral
prompt makes caching more valuable, not less.

**Probe N — two shipped models are unreachable (found while probing, not sought).**

`thinkingmachines/inkling:free` and `thinkingmachines/inkling-small:free` are
both in `MODEL_REGISTRY` (`registry.ts:367,379`) with `isFree: true` and
`certified: "live"`. Both return **HTTP 403 "only available on agentic
harnesses"** — measured with Anvil's exact attribution headers
(`openrouter.ts:50-53`), because a bare request 403s too and the first probe
could not distinguish "Anvil cannot reach it" from "my probe lacked headers".
Verified, not inferred.

`visibleModels()` (`registry.ts:1033-1035`) filters on `isFree !== false`, so
**both appear in the user's model picker, labelled live-certified, and fail for
everyone who picks them.** The cause is the certification system's blind spot
rather than the model list: `certified: "live"` was recorded from a run whose
`certifiedMode` is `"mock"`. `types.ts:199-210` rationalizes that pairing as
"coherent" — and it is coherent as a *verdict* while still being useless as a
*user-facing label*, because the picker shows the verdict and not the mode.

## 2. Wave sequence

| Task | Focus Area | Impact | Priority | Status |
| :--- | :--- | :---: | :---: | :---: |
| **38.1** | One owner for the agent profile (prompt, output budget, verify flag); CLI, headless, and the eval lane all route through it; fail-first parity guard | Probe G, H, I | **P0** | **COMPLETE** |
| **38.2** | Count reasoning tokens in Gemini usage (`thoughtsTokenCount`) so `/context` and compaction stop under-reporting by up to 328× | Probe K | **P0** | **COMPLETE** |
| **38.3** | Retire or re-label the two unreachable `inkling` models the picker offers as live-certified | Probe N | **P0** | **OPEN** |
| **38.4** | A prompt A/B harness on a live model: fixed tasks, N trials, pass rate / cost / tool calls / edit-error rate | Probe H | **P0** | **OPEN** |
| **38.5** | The real system prompt — tool-use policy, search-before-edit, verification, conventions | Probe J, M | **P1** | **OPEN — blocked on 38.4** |
| **38.6** | Reasoning deltas as a first-class `StreamEvent`; surface `reasoning_tokens` and `cached_tokens` in usage | Probe L | **P1** | **OPEN** |
| **38.7** | Prompt caching (`cache_control` breakpoints) for the 4,177-token prefix | Probe M, L | **P1** | **OPEN** |
| **38.8** | Measure closed-loop verification inside the harness; resolve the `autoVerify: false` boundary with data | §4 | **P2** | **OPEN** |
| **38.9** | Guardian gate, docs sync, record | — | **P0** | **OPEN** |

**38.5 is blocked on 38.4 by this phase's own rule.** Writing a better prompt
before a harness can measure it would be an unevidenced change to the only
input that determines agent behavior — the exact defect class this phase exists
to close. The prompt is the payload; the measurement is what lets us ship it.

**38.2 and 38.3 jumped the queue** because the probes turned two hypotheses
into measured defects, and both are user-visible now: a context display that
under-reports by two orders of magnitude, and two models in the picker that
fail for every user who selects them. Neither needs 38.4 to fix, and both are
cheaper than the work they outrank.

**Note on ordering 38.5 vs 38.7:** they are complementary, not exclusive. A longer
behavioral prompt *raises* the value of caching, because Probe M measured the
prefix at 4,177 tokens of which only 11 words are Anvil's own instruction. If
both land, the cache breakpoint must be placed after the static prompt block and
before the volatile conversation tail — 38.7's placement decision depends on
38.5's output, so 38.7 is sequenced after it deliberately.

## 3. Task detail

### 38.1 — Measurement parity (COMPLETE)

`config/agentProfile.ts` is now the single owner of the base prompt, the output
budget, and the verify flag. `cli/src/index.tsx`, `cli/src/headless.ts`, and
`core/eval/runner.ts` all call `buildAnvilAgentProfile()`. `DEFAULT_MAX_TOKENS`
gained its first real callers and now carries the value Anvil actually ran
(`8192`, previously a dead `4096`).

Drift is now structurally impossible rather than merely fixed: a new surface
that re-hardcodes a prompt or a token number fails
`cli/src/__tests__/agentProfileParity.test.ts`.

**Mutation receipt:** the parity guard was run against the **pre-change** call
sites (`git checkout` of all three, tests kept) — **4 of 4 assertions failed**,
naming the exact offenders:

```
packages/cli/src/index.tsx:358          maxTokens: 8192,
packages/cli/src/index.tsx:387          maxTokens: 8192,
packages/cli/src/headless.ts:131        maxTokens: 8192,
packages/core/src/eval/runner.ts:157    systemPrompt: "You are Anvil, an expert coding agent. …"
```

After restoring the change, **4 of 4 pass**. Coverage of the original defect
class: the missing shared owner, the hardcoded prompt, the hardcoded budget,
and the eval lane opting out of the shared owner.

**Baseline preserved:** the mock lane still reports 25/25, and that is now a
*recorded* property rather than a surprise — it is the Probe H receipt in
executable form.

### 38.2 — Token accounting tells the truth on both wire formats (COMPLETE)

The fix is not "add reasoning tokens" — it is that **the two adapters were
wrong in opposite directions**, and only one of them was visible.

- **Gemini adds them.** `thoughtsTokenCount` is reported *outside*
  `candidatesTokenCount` (Probe K: 327 against 1), so the adapter now sums
  them into `outputTokens` — the figure the session budgets and compacts
  against — and breaks the reasoning out separately.
- **OpenAI-style does not add them.** `completion_tokens` *already contains*
  `reasoning_tokens` (Probe L: 515 of 641), so adding would have over-reported
  by 80%. That adapter now surfaces the figure as a breakdown only.
- Both report `cachedInputTokens` as a **breakdown of** `inputTokens`, never an
  addition — cached tokens are counted inside the prompt total by every vendor
  measured.
- `0` and "not reported" are kept distinct: an absent field is `undefined`, so
  no consumer can render "no reasoning" from a provider that never said so.
- The `usage` event is now forwarded whole through `turnStream` rather than
  rebuilt field-by-field. That rebuild was the mechanism by which breakdowns
  were being dropped, so removing it closes the class, not just the instance.
- The status bar now reports thinking share and cache share, and the TUI reducer
  accumulates the optional fields without letting a missing zero overwrite a
  real running total.

**Mutation receipt:** the new `usageAccounting.test.ts` was run against the
**reverted** adapters — **6 of 11 assertions failed**, each naming the real
measured number:

```
expected 1 to be 328          <- Gemini dropped 327 reasoning tokens
expected undefined to be 327  <- reasoning never surfaced
expected undefined to be 800  <- Gemini cached-input ignored
expected undefined to be 515  <- OpenAI reasoning ignored
expected undefined to be 149  <- OpenAI cached-input ignored
expected 100 to be 615        <- the add-vs-do-not-add asymmetry
```

After restoring, **11/11 pass.** The last one is the load-bearing test: it
pins the two adapters' *opposite* correct behaviour, so a future "harmonizing"
edit that adds reasoning twice on the OpenAI path fails rather than silently
over-reporting.

One pre-existing test needed updating rather than deleting: it asserted
`onUsage` was called with a two-field object, which was pinning the very
rebuild that dropped breakdowns. It now asserts the full event is forwarded, and
a second test covers the reasoning/cache path.

### 38.4 — The A/B harness (OPEN, next)

The requirement is a lane that can **fail on a real model and distinguish
provider error from task failure**. `PHASE-36-ROADMAP.md:96` already recorded
that the mock lane "measures the scripted provider, not a model"; this task
makes that lane able to fail. It must report, per trial: pass/fail, whether the
failure was a provider error or a task failure, tool-call count, tokens, and
estimated cost. Tasks must come from the harder tier Phase 37 §4 already called
for (longer horizon, multi-turn, real repo) — the current 25 short tasks are
saturated for this model class.

## 4. Declared boundaries (recorded, not hidden)

- **Anvil discards 2,026 characters of live reasoning per turn** (Probe L) and
  still does, after 38.2. What 38.2 changed is the *accounting*: the tokens are
  now counted, broken out, and shown as a share in the status bar. The reasoning
  **text** is still generated and thrown away — nothing displays it and history
  never stores it, so no user or model can condition on it. 38.6 makes it a
  first-class event. This is stated as a remaining boundary rather than folded
  into 38.2's completion, because "we know how many tokens it cost" and "you can
  read what it said" are different claims and only the first is now true.
- **Reasoning support is still not a feature you can configure.** 38.2 measures
  reasoning that a model chose to spend. Nothing lets a user or a provider
  *request* it: `CompletionRequest` still has no reasoning field, so
  `reasoning_effort` and Anthropic's `thinking` are unreachable. A reasoning
  model works better for it; Anvil cannot yet ask for more or less. That is 38.6,
  and the two should not be conflated in review.
- **Cache hit rates are now visible; the savings are still unrealized.** 38.2
  surfaces `cachedInputTokens` and the status bar shows the share. What it does
  **not** do is ask for a cache: there is still no `cache_control` anywhere, so
  the 4,177-token prefix (Probe M) is cacheable at 4.1× the Anthropic minimum
  and is being paid for as though no cache existed. The 75% hit Probe L measured
  came from OpenRouter's automatic caching, not from anything Anvil does. 38.7
  is the task that captures it.
- **`eval/report.ts` still overstates cost.** It prices `prompt_tokens` at the
  full input rate with no cache discount, so its figures remain an **upper
  bound**. Correcting the record rather than flattering it: earlier cost
  comparisons that treated input tokens as uniformly full-price were wrong in
  Anvil's favour. Pricing the cached fraction properly belongs with 38.7, where
  the cache becomes Anvil's decision rather than a gateway's courtesy.
- **The eval lane keeps `autoVerify: false`.** A repair loop changes the
  trajectory and can mask the exact failure a task asserts, so disabling it is
  a deliberate harness choice, not a leftover. It is now explicit and sourced
  from the shared profile instead of being a silent divergence. The cost is
  real and named: **the harness does not exercise closed-loop verification**,
  which shipping treats as core product behavior. 38.8 measures whether that
  omission hides failures. It is not fixed in this phase.
- **The base prompt is still eleven words after 38.1 and 38.2.** Both tasks fixed
  *measurement*, not the prompt. Anyone reading this doc as "the prompt is now
  good" has misread it: the prompt is unchanged and 38.5 is blocked on evidence.
- **Gemini implicit caching is not reachable.** Probe M measured the Anvil
  prefix at 0.1× Gemini's 32,768-token implicit-cache floor, so Gemini needs
  conversation history to become cacheable at all. 38.7's design must treat
  Gemini as a different case from Anthropic/OpenAI rather than assuming one
  breakpoint strategy fits all three.
- **`goalEngine.ts:406` runs `maxTokens: 4096`**, half the chat budget, in the
  autonomous-mission mode. It is outside the three call sites 38.1 unified
  because goal mode is a deliberately different agent. It is recorded as
  suspicious, not fixed — and Probe K sharpens it: if a reasoning model spends
  its budget on `thoughtsTokenCount` inside a 4,096 ceiling, goal mode is the
  first surface to starve. It is not fixed in this phase.
- **The suite still cannot differentiate frontier models** (carried from Phase
  37 §4). 38.4's harder tier is the first move against it.
- **Two registry models are unreachable and this phase does not yet fix it**
  (Probe N). Recorded here as well as as task 38.3 so the boundary is visible
  to anyone reading the probe receipts before the task lands.

## 5. Method (unchanged, it keeps proving itself)

Probe before believing. The founding probe of this phase (G) was a source
reading, so it was cross-checked against every call site and against the live
call graph before any scope was written — the three-way divergence was
confirmed at file:line, not inferred. A test counts as evidence only if it fails
against the pre-change code: 38.1's guard was run against reverted call sites
and failed 4/4 before a line of the fix was trusted. Measure, never infer, a
number: "the prompt is too thin" is a hypothesis; the 24/25 that described the
wrong agent, and the 645-identical-token mock lane, are the receipts. Declare
what remains open rather than implying it is handled: §4 lists four boundaries,
including the one this phase created and deliberately did not fix.
