# Showcase Deep-Dive Audit — 2026-09-08

Chief-engineer pass before the showcase: full-tree review plus live capture
(packages/tui/scripts/capture-frames.sh against the mock provider), with the
TUI hardening wave from the working tree folded in.

## Baseline (verified before changes)

- typecheck: 3/3 workspaces clean
- tests: 401 passed (core 277, tui 116, cli 8)
- build: all three packages, CLI bundles via esbuild (6.3 MB)

## Found and fixed

1. **Phantom scrollback indicator (the "… N earlier messages" lie).**
   `hiddenMessageCount` accumulated rows newest-first and marked the NEWEST
   message hidden whenever it alone exceeded the budget. A single exchange
   whose answer is taller than the transcript reported "… 2 earlier messages
   above" while the answer was entirely on screen. Fold math corrected: the
   bottom-anchored clip keeps the newest message visible (partial is fine), so
   a message cut mid-way counts the ones ABOVE it, never itself. Verified by
   computation (23-roll estimate on the mock markdown) and by live frame
   capture: "… 2 earlier messages" became "… 1 earlier message" with the
   answer fully visible.
2. **Row-budget reserve over-provisioned.** The estimator reserved 12 rows
   for chrome while the measured 30-row layout actually spends 10 (frame
   borders 2, header 1, two dividers 2, input 3, status 1). Reserve is now
   `rows - 10` so Yoga's real list budget and the indicator agree.
3. **Header truncated the model name mid-word.** "Ollama · Qwen 2.5 Coder
   (Local) [FREE] …" at 100 columns. The cockpit header now (a) measures its
   own deterministic left-column display width and budgets the model tag to
   exactly the remainder, so the right side can never squeeze the left column
   — previously a slightly-wider tag made Ink wrap "▲ ANVIL" across two rows —
   and (b) prefers a compact tag (provider · model) over mid-word "…" because
   state and pricing already live in the StatusBar. Verified across 80-110
   columns: brand single-row, full tag visible at 100+.
4. Uncommitted UI polish wave (from the working tree) integrated and verified:
   theme-consistent colors everywhere, slash-menu styling, sent-message recall
   for command-driven sends (e.g. `/image` flow no longer loses the draft
   recall entry), FirstRunSetup key-entry sanitization.
5. Root-scan for leaks/slop: no unresolved TODO/FIXME, no stray console/debugger
   in src, no `as any` outside provider protocol casts, all timers cleaned up,
   signal handlers for SIGINT/SIGTERM/SIGHUP + MCP cleanup, session history
   writes validated.

## Final state

- typecheck: 3/3 clean
- tests: 403 passed (tui 118 — two new estimator tests: newest-message
  never-hidden + exact-fold boundary)
- build: success
- frames: clean at 30x100 (header full tag, indicator honest, no stacking)

## Follow-up pass (same day — version 0.6.3)

Deeper dive into the provider layer, MCP transport, tool layer, and headless
mode. Verified clean: Gemini thoughtSignature round-trips history → session
file → replay; free-model sync timer is cleared in `finally`; MCP client
routes numeric AND string JSON-RPC ids, fails pending calls fast on transport
death; bash safe-list refuses root-wipes de-shelled and de-substituted; path
containment resolves symlinked ancestors; headless prepends its SIGINT
handler so the graceful-cancel path wins over the CLI exit handler.

**Found and fixed: `grep` ReDoS freeze.** `grep` compiles a model-supplied
JavaScript regex and tests file lines synchronously — no cancellation can
interrupt it. Empirically `(a|aa)+$` hangs Node for >6s on a 38-character
line while `(a+)+$` is optimized away, so the risk is real on the exact
runtime Anvil ships on. Fix: pre-flight shape check
(`grepPatternError` — rejects unboundedly-repeated groups containing
alternation or variable-length repetition; bounded repeats and exact `{n}`
folds stay legal) plus a per-line 4 KB test bound with an honest
`longLinesTruncated` note. The bomb now errors in ~1 ms with an actionable
message; normal searches are untouched. 4 new tests (core 281).

Final state: typecheck 3/3 clean; tests 407 passed (core 281, tui 118, cli 8);
build success; version 0.6.3 across all packages; lockfile resynced.

## Visual regression gate — Phase 0.1 (text-first, deterministic frame capture)

Implemented per `docs/PHASE-0-VISUAL-REGRESSION-SPEC.md`, amended to a
**text-frame** approach: Ink's headless Yoga layout is byte-stable, so the
ANSI-stripped stdout frame *is* the rendered terminal. Text baselines (~2 KB
each) are human-reviewable in PRs and need no PTY / puppeteer / native deps.

- Harness: `packages/tui/src/__visual__/visual.test.tsx` — parameterized fake
  stdout (explicit columns/rows), ANSI-stripped + trailing-whitespace-trimmed,
  deterministic fixtures (no Date.now/timers/network; rewind-modal timestamps
  normalized to `HH:MM:SS`).
- 11 scenarios: empty state, chat exchange (markdown tables/code/tool cards),
  permission prompt with unified diff, mission deck (active + collapsed plan),
  cockpit header at 100/130 cols, compact header at 60 cols, status bar,
  verification + sub-agent card, rewind modal (5 checkpoints).
- `expectVisual` creates-or-compares; `VISUAL_UPDATE=1` regenerates. Negative
  test confirmed: a corrupted baseline fails with a focused diff (1 failed),
  and restoring it returns 11/11 green.
- npm scripts: `visual` (compare), `visual:update` (regenerate).
- Result: 247/247 tui tests pass (incl. 11 visual), `tsc -p packages/tui` clean.
