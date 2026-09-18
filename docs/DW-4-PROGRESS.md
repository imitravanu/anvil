# DW-4 — Next-Gen Views & Layouts — Progress Record (Platform Slice)

> Per AGENTS.md §1: evolution roadmap §DW-4 read, call sites audited first
> (spinner map, slash-menu strings, App overlay structure, boot/exit paths).
> 4.12 was already done (Ph.23.8 throttle). No protected artifacts touched.

## Status: PLATFORM SLICE COMPLETE (views deferred — see §Deferred)

### 4.2 ContextGauge — DONE (`components/ContextGauge.tsx`)
- Adaptive variants (wide: bar+pct+counts, normal: bar+pct, compact: pct),
  semantic colors, blinking red past 90% (timer exists only past 90% — no idle
  churn). Pure `gaugeDisplayText()` mirrors the render for width budgeting.
- StatusBar delegates to it; 100-col frame byte-identical to DW-2.

### 4.3 Braille micro-charts — DONE (`util/braille.ts` + turn wiring)
- `brailleSparkline()` pure (flat→mid, clamped, newest-N windowing).
- Honest data: per-turn input-token deltas recorded in `useAgentController`
  (capped `TOKEN_HISTORY_CAP=24`, reset per session); wide-only sparkline in
  the StatusBar. No fabricated series.

### 4.4 Adaptive theme — DONE (`theme/adaptive.ts`, env layer)
- `detectTerminalTheme()` over `COLORFGBG`; used as the no-config default in
  `bootChat` (null → previous behavior). The live OSC 11 probe stays deferred:
  it needs raw-stdin ownership Ink holds at runtime.

### 4.7 Alt screen — DONE (`cli/src/altScreen.ts` + boot/exit wiring)
- `enterAltScreen`/`exitAltScreen` idempotent, TTY + non-dumb + `ANVIL_NO_ALT_SCREEN=1`
  escape hatch. Entered on chat/setup boot (headless/goal untouched);
  restored on exit, SIGTERM/SIGHUP/SIGINT, and crash (before the error print
  so it lands on the main screen). Test-injectable streams.

### 4.9 Notifications — DONE (`util/notify.ts` + turn wiring)
- Bell + Kitty OSC 777 + iTerm2 OSC 9 to STDERR (never Ink-owned stdout),
  past `LONG_TURN_NOTIFY_MS=60s`, TTY-gated, settings-toggled
  (`settings.json` `notifications.desktop/sound`, default on).
- Permission-prompt pings deliberately excluded (every tool call would page
  the user — noise control).

### 4.11 OSC 52 clipboard — DONE (`util/clipboard.ts`, `/copy`, DiffModal `c`)
- Capped (`CLIPBOARD_MAX_BYTES=100KiB`), TTY-gated, pure sequence builder.
- `/copy` copies the newest fenced block (assistant-preferred); `c` in
  DiffModal copies the visible diff with inline feedback. Ctrl+Y skipped: no
  code-block focus concept exists to attach it to.

### 4.5 Side-by-side diff — DONE (`diff/sideBySide.ts`, `diff/SideBySideDiff.tsx`)
- Pure `pairSideRows()`: del/add runs pair index-wise, leftovers vs blank,
  context with itself, file/hunk/meta as full-width banners.
- `SideBySideDiff` with Before|After header, per-column curtail (pairs can't
  wrap out of alignment), row caps + omission notes like ColorizedDiff.
- DiffModal: auto on at 120+ columns, `s` toggles per visit, both session and
  branch paths; hints updated. Keyboard otherwise untouched.

## Deferred (with reasons)
- **4.1 dashboard / 4.13 panes**: need live team state + focus tree that don't
  exist yet (teams run headless; 3.3 manager deferred). MissionDeck covers
  goal mode today.
- **4.6 floating modals**: absolute overlays tear on scrollback (same finding
  as the palette); in-flow overlays own input safely.
- **4.8 mouse**: needs an SGR-1006 parser + row hit-testing + focus tree —
  its own mini-project; keyboard contracts cover every action.
- **4.10 truecolor**: Shiki/ONNX-grade dep + async highlight pipeline; the
  `cli-highlight` path works and is theme-agnostic.

## Tests (+27 TUI, +5 CLI)
- braille/notify/clipboard/adaptive/gauge/copy-handler/altScreen suites.
- Raw-control-byte sweep over all new files: clean (escapes as text only).

## Baselines
- Zero drift (217/217 incl. 11 visual frames unmodified).
