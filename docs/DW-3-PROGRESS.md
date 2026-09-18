# DW-3 — Interaction Polish & Motion — Progress Record

> Per AGENTS.md §1: evolution roadmap §DW-3 read, spinner/menu/focus call sites
> audited first. No protected artifacts touched. Keyboard contracts unchanged.

## Status: COMPLETE (pending gate)

### 3.1 Spinner system — DONE (`util/useSpinner.ts`)
- `SPINNERS`: dots/80ms (tools, busy), pulse/120ms (streaming wake),
  arrows/100ms (async wait), blocks/100ms (milestone progress). All frames
  single-cell, legacy dots byte-identical. `useSpinnerFrame(active, style="dots")`
  keeps every existing caller behavior-compatible.
- Wiring: ToolCallView/StatusBar/VerificationCard → dots (unchanged);
  MissionDeck in-progress milestone → blocks; DiffModal loading line → arrows.

### 3.4 Streaming cursor — DONE (`MessageView.tsx`)
- Live text ends with a blinking `█` (`useBlink`, 530ms, accent); vanishes on
  settle. Empty streaming state keeps pulse + " thinking…". First frame
  deterministic (visible) for tests.

### 3.2 Command palette — DONE (`commands/palette.ts`, `components/CommandPalette.tsx`)
- Pure `filterCommands`: prefix-first, fuzzy-subsequence second, MRU-boosted
  ties, registry-order fallback; per-command icons (`commandIcon`, `•` fallback).
- Palette renders the framed overlay (icons, footer contract); InputBar
  delegates menu rendering to it — highlight indices share the same list, so
  arrows/Tab/Enter behave exactly as before. Rendered in place above the input:
  Ink absolute overlays tear on scrollback, so "floating" is layout-honest.
- MRU (last 5 successful slash runs) recorded in `useSessionCommands`,
  plumbed App → InputBar → palette. Failed/unknown commands don't pollute it.

### 3.3 Focus indicators — PARTIAL
- Palette carries `borderFocus` while it owns keystrokes (the only focus change
  in this wave). Full `useFocusManager` focus tree deferred: overlays already
  own input exclusively while mounted, so a manager adds machinery without a
  visible difference today. Revisit with DW-4 mouse support, which needs it.

## DW-3 Acceptance (roadmap §DW-3)
- [x] Spinner styles match their contexts (dots/pulse/arrows/blocks wired)
- [x] Command palette opens on `/`, filters (prefix+fuzzy), runs commands
- [x] Streaming cursor during generation, gone when complete
- [ ] Focus indicators on ALL interactive elements (palette only — see above)

## Tests (+17)
- `commands/__tests__/palette.test.tsx` — matcher ranking/MRU/empty/case +
  palette render (icons, footer, empty state)
- `util/__tests__/spinners.test.tsx` — registry shape, legacy dots bytes,
  first-frame determinism per style, blink initial state

## Baselines
- 1 glyph: `mission-deck-active.txt` ⠋ → ▏. All other frames byte-identical
  (cursor/palette/spinners only render in live states).
