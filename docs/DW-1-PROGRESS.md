# DW-1 — Design System & Foundations — Progress Record

> Per AGENTS.md §1: evolution roadmap §DW-1 + audit read, theme infra verified
> (`themes.ts` 11 flat keys, `custom.ts` strict 11-key validation, components use
> only `panelPaddingX`). No protected artifacts touched. No component output
> changed — visual baselines byte-identical.

## Status: COMPLETE (pending gate)

### 1.1 Expanded Theme Token System — DONE
- `tui/src/theme/themes.ts` — 11 legacy keys (stable) + 15 semantic keys
  (`brand/brandDim`, `surfaceElevated/surfaceActive`, `text*`, `success/warning/
  error/info`, `borderFocus/separator`) via `SEMANTIC_DERIVATION` map.
- `resolveThemeColors()` pure migration seam; `Theme` gains `typography`,
  extended `spacing` (cardPaddingX/cardGap/sectionGap), `borders`
  (panel/card/modal), `responsive` (compact/normal/wide widths) — all defaulted.
- `tui/src/theme/custom.ts` — old 11-key files load unchanged (derived +
  defaulted); new semantic overrides and sections validated (reported, never
  half-loaded); built-in shadow list extended.
- `ThemeName` widened to 5 literals; `isThemeName` narrowing preserved.

### 1.2 Built-in Themes Redesign — DONE
- `midnight` (slate blue/coral on deep navy) and `hacker` (matrix green on
  black) added; dark/light/highContrast legacy values byte-identical.
- ThemePicker enumerates `Object.keys(THEMES)` — new themes appear free.
- README custom-theme example renamed (`midnight` → `ember`, since midnight is
  now built-in) and documents the derivation model.

### 1.3 Responsive Breakpoints — DONE
- `tui/src/hooks/useTerminalSize.ts` — `breakpointForWidth()` pure
  (compact <80 < normal <120 < wide <160 < ultraWide) honoring theme thresholds;
  `useTerminalSize()` hook over Ink `useStdout`. No component wired yet (DW-2).

### 1.4 Unicode Design Elements — DONE
- `tui/src/util/chrome.ts` — `CHROME` (corners/lines/dots/arrows/status/bars)
  plus pure `meter()` and `rule()` helpers for DW-2 gauges.

## DW-1 Acceptance (roadmap §DW-1)
- [x] All 5 built-in themes render correctly (visual suite 11/11, colors are
  ANSI-stripped in baselines so value changes are layout-safe)
- [x] Old custom themes auto-migrate with no errors (tested: 11-key file →
  derived semantics + defaulted sections)
- [x] `useTerminalSize()` breakpoints correct (tested incl. custom thresholds)
- [x] Visual regression baselines updated and approved (no changes required)

## Tests (+12)
- `theme/__tests__/custom.test.ts` — registry superset, derivation map, 5
  built-ins, override/section honors, 4 rejection cases
- `hooks/__tests__/terminalSize.test.ts`, `util/__tests__/chrome.test.ts`

## Next (DW-2, not started)
Apply tokens in Header/message cards/permission prompt/StatusBar/pickers/input;
wire breakpoints into Header/StatusBar/pickers; then re-baseline.
