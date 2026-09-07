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