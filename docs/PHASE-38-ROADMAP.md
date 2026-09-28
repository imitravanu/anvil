# Phase 38 — Frontier Agent Brain: measurement before prompt

> **Version:** v1.11.0 → v1.12.0
> **Date:** 2026-09-29
> **Author:** Chief Engineer
> **Core Mandate:** *"We are not making some cheap copy here; we are building frontier coding tools."*
> **Status:** IN PROGRESS — wave 1 landed (38.1, measurement parity, with a
> fail-first mutation receipt). Waves 2–4 are scoped and OPEN: the harness that
> will justify a prompt change does not exist yet, so 38.2 is deliberately blocked.
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

## 2. Wave sequence

| Task | Focus Area | Impact | Priority | Status |
| :--- | :--- | :---: | :---: | :---: |
| **38.1** | One owner for the agent profile (prompt, output budget, verify flag); CLI, headless, and the eval lane all route through it; fail-first parity guard | Probes G, H, I | **P0** | **COMPLETE** |
| **38.2** | The real system prompt — tool-use policy, search-before-edit, verification, conventions | Probe J | **P1** | **OPEN — blocked on 38.3** |
| **38.3** | A prompt A/B harness on a live model: fixed tasks, N trials, pass rate / cost / tool calls / edit-error rate | Probe H | **P0** | **OPEN** |
| **38.4** | Measure closed-loop verification inside the harness; resolve the `autoVerify: false` boundary with data | §4 | **P2** | **OPEN** |
| **38.5** | Guardian gate, docs sync, record | — | **P0** | **OPEN** |

**38.2 is blocked on 38.3 by this phase's own rule.** Writing a better prompt
before a harness can measure it would be an unevidenced change to the only
input that determines agent behavior — the exact defect class this phase exists
to close. The prompt is the payload; the measurement is what lets us ship it.

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

### 38.3 — The A/B harness (OPEN, next)

The requirement is a lane that can **fail on a real model and distinguish
provider error from task failure**. `PHASE-36-ROADMAP.md:96` already recorded
that the mock lane "measures the scripted provider, not a model"; this task
makes that lane able to fail. It must report, per trial: pass/fail, whether the
failure was a provider error or a task failure, tool-call count, tokens, and
estimated cost. Tasks must come from the harder tier Phase 37 §4 already called
for (longer horizon, multi-turn, real repo) — the current 25 short tasks are
saturated for this model class.

## 4. Declared boundaries (recorded, not hidden)

- **The eval lane keeps `autoVerify: false`.** A repair loop changes the
  trajectory and can mask the exact failure a task asserts, so disabling it is
  a deliberate harness choice, not a leftover. It is now explicit and sourced
  from the shared profile instead of being a silent divergence. The cost is
  real and named: **the harness does not exercise closed-loop verification**,
  which shipping treats as core product behavior. 38.4 measures whether that
  omission hides failures. It is not fixed in this phase.
- **The base prompt is still eleven words after 38.1.** 38.1 fixed *measurement
  validity*, not the prompt. Anyone reading this doc as "the prompt is now
  good" has misread it: the prompt is unchanged and 38.2 is blocked on evidence.
- **No prompt caching and no reasoning-model support.** Zero `cache_control`
  and zero thinking/reasoning surface in `providers/`; the docs treat reasoning
  tokens purely as a budget nuisance. Both are real frontier gaps with real
  cost/latency impact and are **not** addressed in this phase. The full deep
  dive and their ranking are recorded in `PROGRESS.md`.
- **`goalEngine.ts:406` runs `maxTokens: 4096`**, half the chat budget, in the
  autonomous-mission mode. It is outside the three call sites 38.1 unified
  because goal mode is a deliberately different agent. It is recorded as
  suspicious, not fixed — a phase should not silently change the budget of a
  mode it is not measuring.
- **The suite still cannot differentiate frontier models** (carried from Phase
  37 §4). 38.3's harder tier is the first move against it.

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
