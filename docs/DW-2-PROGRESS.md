# DW-2 — Component Redesign — Progress Record

> Per AGENTS.md §1: evolution roadmap §DW-2 read, components + tests audited
> first (asserted strings catalogued, frame-shrink bug found live via scratch
> render). Visual-only: zero keyboard/logic changes, all asserted strings kept.
> No protected artifacts touched.

## Status: COMPLETE (pending gate)

### 2.1 Header — DONE (`Header.tsx`)
- Rounded `theme.borders.panel` frame; brand + separators on semantic tokens
  (`brand`, `separator`); git branch gains ● status dot (`success`/`warning`).
- No fabricated gauge (header receives no token data — honesty rule).
- Kept threshold collapse + exact string budgeting; reserve 4 for the frame.

### 2.4 StatusBar — DONE (`StatusBar.tsx`)
- Rounded frame; gauge is now a `meter()` block bar (6 cells) with semantic
  steps (success <50%, warning <75%, error above) + exact pct; test status on
  semantic tokens. Compact (<80, via `breakpointForWidth`) stacks two lines.
- Bar width budgeted so the token readout survives intact at 100 columns.
- `MessageList` chrome reserve 10 → 14 for the framed header/status rows.

### 2.2 Message cards — DONE (`MessageView.tsx`, `ToolCallView.tsx`)
- Role headers with horizontal `rule()` (`❯ you ──`, `anvil ──`) from
  `theme.typography` prefixes (defaults equal old labels — baselines prove it).
- Tool status pills on semantic tokens (identical values on dark by design,
  diverge on midnight/hacker). 3-space indent + markdown pipeline untouched.
- Timestamps deferred (needs event plumbing + /expand toggle — DW-3 candidate).

### 2.3 Permission prompt — DONE (`PermissionPrompt.tsx`)
- Modal border from `theme.borders.modal`; options as full-width bordered boxes,
  selected raised in `brand` with ▸ marker. Labels, hints, MCP badges, word
  diff untouched. Keyboard contract identical.

### 2.5 Model picker — DONE (`ModelPicker.tsx`)
- Context-window badges (`128K`/`2M`), persistent footer hints, panel border
  from theme. Grouping/badges/filter/navigation untouched.

### 2.6 Input bar — DONE (`InputBar.tsx`)
- Panel border from theme, `❯` prompt in `brand`, history-recall indicator
  (`↑↓ browsing history…`, state-mirrored from the recall ref). Submit/recall/
  slash-menu logic untouched.

## Bugs found & fixed during the work
- **Frame shrink-wrap:** a bordered (row-direction) Box shrink-wraps a
  `space-between` child to content — tag rode against the segments. Fixed with
  `flexDirection="column"` + `flexGrow={1}` on the inner row (proven by scratch
  render, then removed). StatusBar/pickers/prompts already column — unaffected.

## DW-2 Acceptance (roadmap §DW-2)
- [x] All components use theme tokens (gate Step 1/1.5 enforces zero hardcoded)
- [x] Responsive shifts at 60/100/130 (baselines) + breakpoint units (DW-1)
- [x] Baselines re-captured and reviewed (8 files; every hunk intended — frames,
  dots, card rules, button boxes, gauge bar, footer; `96 out` preserved)
- [x] Keyboard interactions unchanged (permission/input/picker tests green)

## Known trade-offs
- 100-col cockpit truncates the model tag 1 cell (`Fl…`): the ● dot costs 2
  cells; env segment intentionally kept (existing test + threshold intent).
  Graceful, deterministic, documented in code.
- ~~Timestamps deferred~~ DONE post-wave: `ts` on DisplayMessage (set at
  creation; resumed seeds stay bare), `formatTime()` helper, dim right-edge
  time in card headers gated on `/expand`. Verified right-edge with a probe
  render; visual baselines untouched (visuals don't expand).

## Tests
- 178/178 TUI (no new tests needed — 11 visual frames lock the redesign,
  existing render/interaction tests lock behavior).
