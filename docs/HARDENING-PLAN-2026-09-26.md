# Anvil — Hardening Work Plan (2026-09-26)

> **Origin:** Chief-engineer code-by-code deep dive of the full source tree (2026-09-26). Findings graded F-1…F-9 in the review; this file converts the P1/P2 set into sequenced, executable tasks. A new latent defect (**N-1**, history role alternation) was confirmed empirically during work preparation and is included as **T5**.
>
> **Status:** COMPLETE (2026-09-26) — T1–T6 and T8 shipped; T7 verified already-implemented; T9's index shipped with its physical move deferred; T10/N-2 fixed. Full gate green: 1,136 tests, 25/25 mock evals, exit 0. Post-review fixes are recorded in `PROGRESS.md` (T8 now declares the SDKs it externalizes; the IFS normalization covers every expansion spelling).
>
> **Entry protocol (AGENTS.md §1):** before touching any file, declare ownership in `PROGRESS.md`; run `npm run gate` before and after every task; verify anchors against the live tree (line numbers drift).

## 0. Ground rules

- **No new npm dependencies.** Tests use vitest + existing harnesses only.
- **Numeric bounds** live in `packages/core/src/config/constants.ts` (constitution §2.4).
- **Error discipline:** `getErrorMessage()`, no silent catches, no type escapes — the in-product guardian enforces these on every mutating write and the gate enforces them on sources.
- **Docs are outside the gate PATHSPEC** (`packages/*/src/**` only) but must ride with the doc-truth assertions that keep them mechanically honest (T2).
- **No protected artifact is touched by T1–T9.** The F-6 CI slice (scheduled live certification under `.github/workflows/`) is deliberately excluded — it requires the human-reviewed protected-artifact procedure (AGENTS.md §3.4) and is listed as a human-owned follow-up.

## 1. Baseline (pre-work, commit `2d22f8f`, 2026-09-26)

| Check | Result |
|---|---|
| `npm run typecheck` | ✅ exit 0, 0 TS errors (3/3 workspaces) |
| `npm run build` | ✅ exit 0 (CLI bundle 6.5 MB, esbuild 461 ms) |
| `npm test` | ✅ 1,116 tests / 160 files, 0 failures |
| `.fresh-allowlist.json` | `"entries": []` — zero legacy exceptions |
| `git status` | clean; hooks installed (`core.hooksPath=.githooks`) |
| `npm run gate` | ✅ PASS — full run record in §6 |

## 2. Sequencing

| ID | Task | Stream | Pri | Size | Depends |
|----|------|--------|-----|------|---------|
| T1 | Bash destructive-refusal hardening (`$IFS`-class expansion) | Security | P1 | S | — |
| T2 | Doc-truth closure (model count + superseded-roadmap guard) | Truth | P1 | S | — |
| T3 | Context-estimation calibration (CJK-aware + measured-usage factor) | Accuracy | P1 | M | — |
| T4 | Plugin argv execution mode (stop shell-splicing model input) | Security | P1 | M | — |
| T5 | **N-1** — empty-turn alternation repair (`user -> user` adjacency) | Correctness | P1 | S | — |
| T6 | History-invariant property tests (seeded, no deps) | Durability | P2 | M | T5 |
| T7 | Certified-mode badge in the model picker | Honesty | P2 | S | — |
| T8 | CLI startup/bundle measurement | Perf | P2 | S | — |
| T9 | Docs archive pass | Hygiene | P3 | M | T2 |
| T10 | **N-2** — entry-point harness timeout (gate flake, found by the gate) | Reliability | P1 | S | — |

**Order:** T2 → T5 → T1 → T3 → T4 → T6 → T7 → T8 → T9.
Rationale: T2 is docs-only (zero runtime surface, exercises the gate); T5 is a confirmed small correctness fix with an exact repro; T1 is self-contained; T3/T4 are independent; T6 hardens the T5 contract into an invariant; T7–T9 are polish.

**Status:** COMPLETE (2026-09-26) — T1–T6 and T8 shipped; T7 verified already-implemented; T9's index shipped (physical move deferred, reasons recorded); T10/N-2 fixed. Full gate green: 1,136 tests, 25/25 mock evals, exit 0. T10 (N-2) was discovered and fixed by the T1 gate run itself. Post-review fixes are recorded in `PROGRESS.md`.

## 3. Task cards

### T1 — Bash destructive-refusal hardening

**Why:** probe (2026-09-26) — `isBlockedCommand("rm -rf$IFS/")` returns `null` (allowed) while `rm -rf /` is refused. `$IFS` expands to whitespace inside the shell, so `isRootWipe`'s `SYSTEM_PATHS` regex sees no whitespace boundary before the target. Same class: `${IFS}`, `$'…'` ANSI-C quoting.

**Reality check (RED first):** after `npm run build -w @anvil/core`:
`node --input-type=module -e "import('./packages/core/dist/tools/bash.js').then(m=>console.log(m.isBlockedCommand('rm -rf$IFS/')))"` → currently `null`.

**Files:** `packages/core/src/tools/bash.ts` (`segments` ~L128, `isRootWipe` ~L138, `SYSTEM_PATHS` ~L157), `packages/core/src/tools/__tests__/bash.test.ts` (blocked table ~L148, allowed table ~L175).

**Change:** normalize whitespace expansions before matching — replace `$IFS` / `${IFS}` with a space; strip `$'…'` / `$"…"` ANSI-C quoting so its content is inert. Update the "best-effort, not a sandbox" comment to name the new normalization and keep it truthful. Do not over-block project-local targets.

**Tests (table-driven, matching the file's existing style):** blocked — `rm -rf$IFS/`, `rm -rf${IFS}/`, `rm -rf$IFS ~`, `rm -rf$'\x20'/`, `rm -rf "$IFS"/usr`; allowed — `rm -rf ./build`, `rm -rf ./dist/`, `rm -rf $BUILD_DIR` (documented false-negative boundary: an arbitrary variable target is not enumerable and the permission prompt remains the gate).

**Acceptance:** probe returns a reason; `npm test -w @anvil/core` green; `npm run gate` green.

**Out of scope:** a real sandbox (namespaces/seccomp) and full shell parsing.

---

### T2 — Doc-truth closure

**Why:** README (~L31) says "49 built-in models"; the registry now holds 73 rows (61 free-visible). `docs/ANVIL-COMPLETE-ROADMAP.md` still claims "Version: 0.8.0 (current)" and "single source of truth for all remaining development", but Phases 21–28 have shipped since; the active guide is `docs/PHASE-28-ROADMAP.md`. The existing `docTruth.test.ts` asserts provider/tool/version/table counts but not the model count or this header.

**Files:** `README.md` (~L31), `docs/ANVIL-COMPLETE-ROADMAP.md` (header block only), `packages/cli/src/__tests__/docTruth.test.ts`.

**Change:** (a) reword the README model sentence to the code-owned number (derive from `visibleModels().length`; state the registered total parenthetically if useful) and keep the live-sync clause only if still true; (b) demote the old roadmap header to a superseded banner pointing at `docs/PHASE-28-ROADMAP.md` + `PROGRESS.md`; (c) extend docTruth with two assertions: README contains `${visibleModels().length}` in the model-picker bullet, and the superseded roadmap names a successor file that exists on disk.

**Tests:** new assertions fail before the doc edits (RED), pass after.

**Acceptance:** `npm test -w @anvil/cli` green; `npm run gate` green.

**Out of scope:** rewriting historical phase docs; archiving (T9). Do not "fix" the stale header by bumping a version number — the successor pointer is the mechanical fix for the whole class.

---

### T3 — Context-estimation calibration

**Why:** `agent/context/scoring.ts` estimates tokens as `chars / 4` and images as a flat 2000 — materially wrong for CJK text (≈1 token/char) and for large diffs; compaction thresholds key off these estimates, so under-estimation risks provider CONTEXT_OVERFLOW errors at turn start. The raw literals also sit outside the constants module.

**Files:** `packages/core/src/agent/context/scoring.ts`, `packages/core/src/config/constants.ts`, `packages/core/src/agent/session.ts` (calibration seam next to `lastInputTokens`), `packages/core/src/agent/compaction.ts` (`estimateTokens`), tests under `agent/context/__tests__/` and `agent/__tests__/`.

**Change:** (a) char-class-aware estimate (ASCII ≈ /4; CJK + CJK punctuation ≈ 1/char; clamp); (b) session-local calibration factor = clamp(measured usage / estimate) updated from provider `usage` events, applied to subsequent estimates, seeded to 1.0 on restore; (c) move the remaining literals (weights, per-image tokens) into named constants with comments.

**Tests:** CJK estimate ≥ ASCII estimate at equal length; a fake provider reporting 2× the estimate moves a boundary case across the compaction threshold; factor clamps to [0.5, 2.0]; restored sessions start at 1.0.

**Acceptance:** existing compaction tests green (adjust only where the new estimator legitimately changes a number, with a comment); `npm run gate` green.

**Out of scope:** a tokenizer dependency; per-model exact ratios (calibration covers residual error).

---

### T4 — Plugin argv execution mode

**Why:** `plugins/registry.ts` (~L16–L24) documents that the `{input}` JSON is shell-spliced and the prompt cannot render the rendered command; the durable fix is named in the note itself: pass the JSON as a real argv element.

**Files:** `packages/core/src/plugins/registry.ts`, `packages/core/src/plugins/loader.ts` (manifest validation), `packages/core/src/plugins/types.ts`, `packages/core/src/plugins/__tests__/plugins.test.ts`, README plugins section if it documents templates.

**Change:** (a) manifest accepts `args: string[]` (validated: array of strings, bounded count via constants, no null bytes) where each element may contain `{input}`; when `args` is present, execute `spawnSync(command, args.map(fill), { shell: false })` so the JSON is one argv element; (b) `command`-only templates keep the legacy `bash -c` path with the trust note retained and a `--verbose` warning; (c) define precedence and validation errors (`command` + `args` together: `command` is the binary).

**Tests:** input `{"x":"; rm -rf /tmp/never"}` through an `args` template arrives as ONE argv element (fixture script proves no second command ran); legacy path unchanged; invalid `args` rejected by the loader as a problem, never executed.

**Acceptance:** plugin tests green; fixture proves no shell interpolation; `npm run gate` green.

**Out of scope:** threading the tool name into the permission `describe` seam so the prompt can render the argv (follow-up T4b, P2 — touches the external-describe signature in `tools/index.ts`).

---

### T5 — N-1: empty-turn alternation repair

**Why:** confirmed repro (2026-09-26): an assistant turn that produces no text and no tool calls records nothing (`HistoryStore.pushAssistant` returns `false`), so the next user message yields `user -> user` adjacency — which the repo's own comments say several providers reject. Reachable paths: (1) an empty `max_tokens`/`unknown` stop (documented real case: Inception burns reasoning tokens and can return an empty length-cutoff turn); (2) Esc-cancel before any stream output. Result: the next send fails at the provider with a malformed-history error and the session looks "stuck".

**Repro:**
`node --input-type=module -e "const {HistoryStore}=await import('./packages/core/dist/agent/historyStore.js'); const h=new HistoryStore(); h.pushUserText('a'); console.log(h.pushAssistant([],[])); h.pushUserText('b'); console.log(h.get().map(m=>m.role).join(' -> '));"` → `false` then `user -> user`.

**Files:** `packages/core/src/agent/historyStore.ts` (`pushUserText` ~L65, `pushAssistant` ~L97), `packages/core/src/agent/__tests__/historyStore.test.ts`.

**Change:** in `pushUserText`, when the last message is a user message containing text and no tool_result parts, merge the new text (and images) into it instead of pushing a second user message — mirroring `mergeContent` semantics. This repairs both paths at the one place history is written, and keeps `/retry` unwinding correct (a merged pair is one user turn). Keep `pushAssistant`'s no-empty-push rule as is.

**Tests:** empty-turn path (repro above) ends in a single merged user message; cancel-before-stream path same; tool-result-bearing user messages are never merged; `/retry` after a merge returns the merged text; images survive the merge.

**Acceptance:** `npm test -w @anvil/core` green; `npm run gate` green.

**Out of scope:** changing provider adapters (they replay whatever the store owns).

---

### T6 — History-invariant property tests (seeded, dependency-free)

**Why:** the hardest invariants (role alternation, tool_call ↔ tool_result pairing, no empty pushes, declared-order replay) are pinned by examples and comments, not by properties. Random event orders (abort mid-batch, denial, budget exhaustion, empty turns) are exactly where they break — T5 is one proven instance.

**Files:** new `packages/core/src/agent/__tests__/historyInvariants.property.test.ts` (plus T5's merged-user-message rule).

**Change:** a small seeded LCG drives deterministic sequences (N = 200) through `HistoryStore` + `TurnState` + the session's tool-result ordering rules. After every step assert: (1) no message has empty content; (2) every tool_call id is answered by exactly one tool_result before the next assistant turn; (3) no two adjacent messages share a role (the T5 contract); (4) tool results appear in declared call order; (5) `repairUnclosedToolCalls` is idempotent. Failure messages must print the seed for exact reproduction. If the generator finds a counterexample beyond T5, record it in `PROGRESS.md` and fix or file it — never weaken the assertion to pass.

**Acceptance:** suite runs in < 5 s; deterministic for a given seed; `npm run gate` green.

**Out of scope:** adding a property-testing dependency; full `AgentSession` simulation (start at the store level; it can grow later).

---

### T7 — Certified-mode badge in the model picker

**Why:** F-6 — the registry separates `certified` from `certifiedMode` exactly so a mock pass cannot masquerade as a live probe, but the picker shows neither, so a mock-certified model reads as verified.

**Files:** `packages/tui/src/components/ModelPicker.tsx`, `packages/tui/src/util/format.ts`, tests under `packages/tui/src/components/__tests__/` and `packages/tui/src/util/__tests__/`.

**Change:** per-row provenance tag derived from `certifiedMode` (`live✓` / `mock✓` / `—` when absent). Never render a live token when the mode is absent or not `live`.

**Tests:** a mock-certified row shows only the mock token; absent mode shows the unrecorded token; no row shows the live token when `certifiedMode !== "live"`.

**Acceptance:** `npm test -w @anvil/tui` green; `npm run gate` green.

---

### T8 — CLI startup/bundle measurement

**Why:** F-7 — the CLI bundles to 6.5 MB; startup cost is unmeasured, so "it's fine" is unverified. Measure before optimizing.

**Files:** new `scripts/measure-startup.mjs` + a `package.json` script entry.

**Change:** median/p95 of 10 cold and warm `node packages/cli/dist/index.js --version` runs plus a dist-size table; optional experiment marking provider SDKs external, kept only if the gate stays green and startup improves measurably. Numbers live in the script output — not a doc.

**Acceptance:** script runs via `npm run measure:startup`; no CLI behavior change; `npm run gate` green.

---

### T9 — Docs archive pass

**Why:** F-8 — 60+ docs; `PROGRESS.md` 112 KB; `CHANGELOG.md` 97 KB.

**Files:** `docs/archive/**` moves + `packages/cli/src/__tests__/docTruth.test.ts` path update in the SAME change (it reads `docs/STABILIZATION-ROADMAP-2026-09.md`); new `docs/README.md` index.

**Change:** move completed phase records into `docs/archive/`; keep `docs/PHASE-21-25-AUDIT.md` (protected) and active guides in place; the index splits active vs archive.

**Acceptance:** tests + gate green; `git diff --name-only` shows no protected artifact.

---

## 4. Verification matrix

- **Targeted:** `npm test -w @anvil/core` / `-w @anvil/tui` / `-w @anvil/cli`
- **Full (required per task):** `npm run gate` — baseline already green (§6)
- **Fast path while iterating:** `node scripts/verify-gate.mjs --staged --quick` (stages 0–1.5)
- **Probes:** T1 dist probe, T5 repro one-liner, T4 argv fixture, T8 measurement table

## 5. Definition of done (per task)

1. RED test/probe recorded before implementation.
2. Implementation + tests green.
3. `npm run gate` green (a failing step is fixed, never bypassed).
4. `PROGRESS.md` block: files owned, change, evidence, gate result.
5. `git diff --name-only` contains no protected artifact.
6. Docs / docTruth updated whenever a count, claim, or contract changed.

## 6. Baseline record — `npm run gate`, 2026-09-26, commit `2d22f8f`

| Step | Result |
|---|---|
| 0 — gate sensor | ✅ all intentional violation fixtures detected |
| 0.5 — protected-artifact hashes | ✅ gate, constitution, allowlist, audit, sentinel, CI |
| 1 — diff slop scan | ✅ zero new patterns |
| 1.5 — full-tree residual scan | ✅ zero legacy slop |
| 2 — build (core → tui → cli) | ✅ sequential, clean |
| 3 — typecheck | ✅ 0 errors, 3/3 workspaces |
| 4 — unit tests | ✅ 1,116 tests / 160 files |
| 5 — mock evals | ✅ 25/25 tasks |
| **Overall** | **🎉 GUARDIAN GATE PASSED (exit 0)** |

**Plan complete (2026-09-26).** Shipped: T1, T2, T3, T4, T5+T6, T8, T9 (index). Verified already-implemented: T7. Deferred with recorded reasons: T9's physical `docs/archive/` move, T8's lazy-provider-loading follow-up, and the CI live-certification slice (protected artifact → human-owned). Last full gate: 1,136 tests, 25/25 evals, exit 0. Post-review (see `PROGRESS.md`): T8's bundle now declares the SDKs it externalizes, the IFS normalization covers every expansion spelling, and the three status lines in this file now agree.

