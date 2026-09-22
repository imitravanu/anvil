# DW-3 — Interaction Polish & Motion — Progress Record

> Per AGENTS.md §1: evolution roadmap §DW-3 read, spinner/menu/focus call sites
> audited first. No protected artifacts touched. Keyboard contracts unchanged.

## Status: COMPLETE — gate passed 2026-09-23 (3.3 closed)

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

### 3.3 Focus indicators — DONE (`components/*` frames + `theme/__tests__/focusContract.test.ts`)
- **Audit first (all 9 `useInput` surfaces).** Every keyboard owner already
  renders a visible selection marker — `❯` prefix, or `inverse` on the active
  DiffModal row — and InputBar carries the `❯` prompt + cursor. So "which option
  is focused" was never the gap. The gap was the **frame**: the `borderFocus`
  token existed in all 5 themes (deliberately brighter than `border`) but only
  the palette used it, so a panel owning input looked identical to a static one.
- **Rule applied:** the frame of the surface that owns keystrokes carries
  `borderFocus`. Wired into DiffModal, RewindModal, ModelPicker, SessionPicker,
  ThemePicker, and InputBar (bright while ready, `dim` while a turn streams,
  because the box is non-interactive then).
- Esc-only empty states keep the structural `border` — they present nothing
  focusable, so a focus border there would be a false signal.
- **PermissionPrompt keeps its `warning` frame deliberately:** that border is the
  danger signal for a mutating tool call, and danger outranks focus. Its focus
  position is the selected action button (brand border + `▸` + bold).
- `FirstRunSetup` renders inline without a frame (like InputBar's inline form);
  its `❯` selection is the indicator.
- **Evidence limit, stated honestly:** colors are unobservable in this harness —
  non-TTY test stdout makes chalk emit no ANSI (documented in
  `test-utils/testRender.tsx`) and the visual baselines are ANSI-stripped text.
  So no behavioural test can see this change, and none is claimed. What *is*
  verified: zero visual-frame drift (11/11), 47/47 TUI files green, typecheck
  clean, and the load-bearing part — NEW `focusContract.test.ts` (3 tests)
  asserting every built-in theme defines a `borderFocus` that **differs from**
  `border`, so the affordance can never silently render as nothing.
- **Machine-consumable focus tree still deferred to DW-4.8 (mouse).** Ownership
  is already exclusive per render branch — `App` renders exactly one of these
  surfaces or InputBar — so a registry adds no behaviour until row hit-testing
  needs it. That deferral is unchanged, not forgotten.

## DW-3 Acceptance (roadmap §DW-3)
- [x] Spinner styles match their contexts (dots/pulse/arrows/blocks wired)
- [x] Command palette opens on `/`, filters (prefix+fuzzy), runs commands
- [x] Streaming cursor during generation, gone when complete
- [x] Focus indicators on ALL interactive elements (see §3.3 — audit + focus-border rule)

## Tests (+20)
- `commands/__tests__/palette.test.tsx` — matcher ranking/MRU/empty/case +
  palette render (icons, footer, empty state)
- `util/__tests__/spinners.test.tsx` — registry shape, legacy dots bytes,
  first-frame determinism per style, blink initial state
- `theme/__tests__/focusContract.test.ts` — 3.3: every built-in theme defines a
  non-empty `borderFocus`, it differs from `border` in every theme, and the token
  stays declared as semantic (so custom themes must supply it)

## Baselines
- 1 glyph: `mission-deck-active.txt` ⠋ → ▏. All other frames byte-identical
  (cursor/palette/spinners only render in live states).
