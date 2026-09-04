# PHASE 8 — IMPLEMENTATION PROGRESS & REVIEW RECORD

> Maintained by the architect during implementation. Other agents: read this
> BEFORE continuing work. Status below is verified against the working tree,
> not against anyone's report. Last verified: REVIEW pass 2 + PHASE 8.5.

## 0. PHASE 8.5 — UI QUICK WINS (client-approved "yes 8.5"): ✅ COMPLETE

Scope: UI-ROADMAP U1–U4. Verified: typecheck 0 errors, core 116/116,
tui 17/17 (3 files), build OK.

- **U1 persistent plan line**: `PlanLine` component + `collapsePlan()` pure
  helper (tested) + `useAgentController` now tracks `plan` state (seeded from
  session, live-updated on `plan_updated`, reset on session change).
- **U2 streaming caret**: discovered the interrupted concurrent session had
  ALREADY implemented it (braille spinner after streaming text). Kept theirs;
  architect's blink-caret variant removed as redundant. LESSON: re-read the
  current file before editing — concurrent sessions exist.
- **U3 NO_COLOR**: guard in `highlightCodeBlocks` (raw-ANSI path); fenced code
  still stripped; 2 tests. `<Text>` colors honor NO_COLOR via chalk.
- **U4 cosmetic choices closed**: defaults finalized (see PRODUCT-POLISH-RECORD
  §13). No code change.
- Records updated: UI-ROADMAP (statuses), PRODUCT-POLISH-RECORD (§13 closed).

## 1. VERIFICATION SNAPSHOT (regression gate, run on current tree)

| Gate | Result |
|---|---|
| `npm run typecheck` (core+tui+cli) | ✅ 0 errors |
| `npm test -w @anvil/core` | ✅ 116/116 (97 original + 8 A-tests + 11 B-tests) |
| `npm test -w @anvil/tui` | ✅ 11/11 (C pure helpers: format 5, markdown 6) |
| `npm run build` (incl. esbuild bundle) | ✅ succeeds |

## 2. ACCEPTANCE SCORECARD

### Workstream A — THE DURABLE LOOP: ✅ COMPLETE (verified by tests)
- A1 concurrent read-only batch + declared-order results — PASS
- A2 mutating batch strictly serial — PASS
- A3 budget (default 20) → exactly one budget_exhausted, history notice — PASS
- A4 loop guard: 3rd identical flagged once, 4th refused pre-execution — PASS
- A5 update_plan → plan_updated, session.plan, persist + restore — PASS
- A6 ledger records, persists, caps at 1000 — PASS
- A7 all 97 original tests still green — PASS

### Workstream B — FREE-MODEL TRUTH: ✅ COMPLETE (verified by tests)
- B1 single-flight (concurrent calls → one fetch) — PASS
- B2 TTL no-op — PASS
- B3 source failure → report contains error, never throws, no partial state — PASS
- B4a/b/c register-new / demote / promote — PASS
- B5 cache v2 round-trip, legacy migration, staleness honesty — PASS
- B6 staleness helper unit-tested; picker shows stale notice — PASS (wired)
- Coordinator owns ALL THREE former call sites (CLI boot, picker, /sync) — DONE
- 429 health: recorded (noteRateLimited) + `[rate-limited]` picker tag — DONE

### Workstream C — UI POLISH: ✅ COMPLETE (REVIEW pass 2 — finished after the
### interrupted session; all §3 items below implemented and gates green)

DONE: C1 helpers (`util/labels.ts`, `util/format.ts`, tested) + App dedupe;
C2 renderer + `MarkdownView.tsx` (tested) + MessageView wiring (streaming stays
plain, code highlighted inside MarkdownView); C3 StatusBar two-zone + curtail +
SessionPicker curtail/labels; C4 EmptyState brand block + version + /connect +
spinner moved to `util/useSpinner.ts`; C5 copy (FirstRun steps 1/2, saved line,
PermissionPrompt active labels, /help examples); C6 theme tokens (`accent`/
`surface`) consumed by App frame (border) and InputBar (accent idle); C7 vitest
seed in tui (+ `vitest.config.ts` include-src fix, see §5.6).
A-event passthrough (FINDING-1 resolution): `useAgentController` now surfaces
`budget_exhausted` / `loop_detected` / `plan_updated` as system messages, and
`resumeFromStored` re-emits a persisted plan once.

## 3. REMAINING WORK — NONE (all §3 items completed; kept for audit trail)

1. **MessageView wiring (C2):** completed assistant text must render via
   `<MarkdownView blocks={parseMarkdownText(message.text)} />`; streaming text
   stays plain (no mid-stream markdown — flicker rule). Remove the direct
   `highlightCodeBlocks` call from MessageView (MarkdownView handles code).
2. **A-event passthrough (see FINDING-1):** `useAgentController.applyEvent`
   must handle `budget_exhausted`, `loop_detected`, `plan_updated` — print a
   system message for each. Today they are silently dropped.
3. **App.tsx:** import `PROVIDER_LABELS` from `util/labels.js` (delete the
   local copy; update the `handleConnectDone` use); outer frame border →
   `theme.colors.border`; after `resumeFromStored`, if `restored.plan` print
   `Plan: …` once (A.1.4 re-emit).
4. **InputBar:** idle border → `theme.colors.accent` (busy stays `dim`).
5. **SessionPicker:** `curtail(title, 40)` + `displayModelLabel(meta.model)`.
6. **PermissionPrompt copy (C5):** label map — edit_file → "wants to edit a
   file", write_file → "wants to write a file", run_command → "wants to run a
   command", default `wants to ${tool.replace(/_/g, " ")}`.
7. **FirstRunSetup copy (C5):** "Step 1 of 2 / Step 2 of 2"; saved line
   "✓ … — add more or press Enter to continue".
8. **/help examples (C5):** one usage example per command in the help output.
9. Re-run section 8 verification (PRODUCT-POLISH-RECORD) + update the §2
   scorecard here.

## 4. FINDINGS (classified)

- **FINDING-1 — SPEC BUG.** PHASE-8-SPEC §10 limited TUI work to "two thin
  surfacing points + /sync report" and did not list display of the NEW A-events
  (`budget_exhausted`, `loop_detected`, `plan_updated`). Result: core emits the
  events but the TUI silently drops them — contradicting the phase's own
  principle ("never truncate silently"). Resolution (approved by architect):
  add the three cases in `useAgentController` (§3 item 2) and the plan re-emit
  on resume (§3 item 3). Recorded here per change control.
- **FINDING-2 — record correction (not a bug).** PRODUCT-POLISH-RECORD §7
  lists `theme/theme.ts` as modified, but no change is needed there: the
  `Theme` type derives from `THEMES`, so adding tokens to `themes.ts` is
  sufficient. Treat that allowlist line as "no-op".
- **FINDING-3 — no violation.** `ModelPicker.tsx` and `cli/src/index.tsx`
  changes sit outside the C allowlist but inside PHASE-8-SPEC B.2/B.3
  (surfacing + call-site migration). Cross-referenced, allowed.

## 5. EMPIRICAL DISCOVERIES (added to Known Gotchas — all agents read)

1. **TUI/CLI compile against core's BUILT dist** (`dist/index.d.ts`), not src.
   After ANY core change: `npm run build -w @anvil/core` BEFORE
   `npm run typecheck`, or tui/cli report phantom "no exported member" errors.
2. **A source that returns an empty live list cannot drive demotions** —
   provider attribution falls back to the source id. Demotion requires a
   non-empty list that simply omits the model (mirrors reality: an empty list
   is a source glitch, not "everything became paid"). Covered by test B4b.
3. **The history model has no "system" role** (`Role = "user" | "assistant"`).
   Budget/loop notices are rendered as: budget → assistant-role text message
   (safe alternation after a tool_result user message); loop demand → leading
   user-role text part merged INTO the tool_result message (a separate user
   message between assistant tool_call and user tool_result would break
   Gemini's functionResponse adjacency).
4. **A refused loop-guard call emits NO tool_started/tool_finished** — it is
   refused pre-execution and surfaces only as a tool_result error (test A4).
5. `models-cache.json` honors `ANVIL_HOME` (tests relocate it); the path is
   resolved lazily per call, so the env may be set after import.
6. **The tui build compiles tests into `dist/`** — vitest then counted every
   pure-helper test TWICE (src + dist copy: 22 "tests" that were really 11).
   Fixed with `packages/tui/vitest.config.ts` (`test.include` = `src/**`).
   If you add tui tests, they are discovered from `src/` only.

## 6. FILE ALLOWLIST STATUS (REVIEW pass 1: no violations)

All currently modified files are within PHASE-8-SPEC (A/B) + PRODUCT-POLISH
RECORD §7 (C) + two documented exceptions (FINDING-3; `package-lock.json` for
the C7 vitest devDependency only).