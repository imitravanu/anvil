# Phase 28 — Visual Identity & UX Refinement (v1.3.0) — Agent Build Guide

> **Version:** v1.2.0 → v1.3.0  
> **Date:** 2026-09-23  
> **Author:** Chief Engineer Audit  
> **Origin:** Deep analysis of the full TUI codebase (73 source files in `@anvil/tui`), the `anvil-ui-demo` forge prototype (`/home/mitravanu/anvil-ui-demo/demo.mjs`), completed DW-1→DW-4 design waves, and current UI/UX gaps identified during a full-stack review.  
> **Purpose:** This document is the **actionable build guide** for any agent working on Anvil's visual identity and UX refinement. Every task has exact file paths, modification instructions, watchouts, and acceptance criteria. Tasks are sequenced — **do not skip ahead**.
> **Progress (2026-09-26) — verified against code & tests:** 28.1 ✅ forge theme (`a2088ca`), 28.2 ✅ diff tints (`2d22f8f`), 28.3 ✅ tool call timing, 28.4 ✅ thinking elapsed indicator, 28.5 ✅ animated wordmark, 28.6 ✅ thin/theme-selectable meters, 28.7 ✅ compact inline permission bar, 28.8 ✅ muted-vs-dim pass (enforced by `theme/__tests__/dimContract.test.ts`), 28.9 ✅ header session title & turn counter (pure `headerSessionPlan` gates: title ≥92, turns ≥105), 28.10 ✅ per-turn token cost line (usage events accumulate onto the turn's message; `/expand`-gated, settled-only, absent on resumed history), 28.11 ✅ code-block line numbers (≥3 lines, right-aligned, `#L24` fence anchors honored, true numbers across the head+tail window — and the fix removed a long-standing phantom `▎` line the highlighter's trailing newline manufactured), 28.12 ✅ forge added to the PNG matrix (18 configurations, 144 frames — all pass). 28.4–28.7 were **adopted from a session that stopped mid-phase** (it never declared ownership in `PROGRESS.md`; its uncommitted work was verified green against the full gate, completed, and landed — see `PROGRESS.md` 2026-09-26). Its sequencing was in order: 28.4→28.5→28.6→28.7, with 28.8 started and finished by the takeover session. **Phase 28 is complete.** A box is ticked only once its criterion is confirmed in the live tree; criteria that need a real interactive terminal (28.4's `✻` on glass, 28.5's live keypress-skip) are deliberately left unticked until a human pass confirms them.

---

## ⚠️ MANDATORY ENTRY PROTOCOL

Before touching ANY file:

1. **Read `AGENTS.md`** — the Agent Constitution v2.2 is law. Violations break the gate.
2. **Read this file top-to-bottom** — tasks are sequenced; later tasks depend on earlier ones.
3. **Run `npm run gate` before and after every task** — the gate is the definition of done.
4. **Declare file ownership in `PROGRESS.md`** — multi-agent collision guard.
5. **Verify paths against the live tree** — line numbers drift; `grep` before editing.

---

## Table of Contents

1. [Sequencing Rule](#1-sequencing-rule)
2. [28.1 — Forge Theme (New Built-In)](#28-1--forge-theme-new-built-in)
3. [28.2 — Diff Background Tints](#28-2--diff-background-tints)
4. [28.3 — Tool Call Timing Metadata](#28-3--tool-call-timing-metadata)
5. [28.4 — Thinking Elapsed Indicator](#28-4--thinking-elapsed-indicator)
6. [28.5 — Animated Wordmark Empty State](#28-5--animated-wordmark-empty-state)
7. [28.6 — Thin Meter Variant & Theme-Selectable Meters](#28-6--thin-meter-variant--theme-selectable-meters)
8. [28.7 — Compact Permission Prompt (Inline Mode)](#28-7--compact-permission-prompt-inline-mode)
9. [28.8 — Muted vs Dim Token Refinement](#28-8--muted-vs-dim-token-refinement)
10. [28.9 — Header Session Title & Turn Counter](#28-9--header-session-title--turn-counter)
11. [28.10 — Message Cost Annotations](#28-10--message-cost-annotations)
12. [28.11 — Code Block Line Numbers](#28-11--code-block-line-numbers)
13. [28.12 — Visual Regression Baseline Refresh](#28-12--visual-regression-baseline-refresh)
14. [Standing Rules for All Agents](#standing-rules-for-all-agents)

---

## 1. Sequencing Rule

```
28.1 (forge theme) → 28.2 (diff tints) → 28.3 (tool timing)
→ 28.4 (thinking indicator) → 28.5 (animated wordmark)
→ 28.6 (meter variant) → 28.7 (inline permission)
→ 28.8 (muted/dim refinement) → 28.9 (header session)
→ 28.10 (message cost) → 28.11 (code line numbers)
→ 28.12 (visual regression refresh)
```

**Why this order:** 28.1 establishes the new theme tokens that 28.2–28.6 consume. 28.5 depends on 28.1's `heat`/`spark` tokens. 28.7–28.11 are independent features but should land after the foundational visual identity changes so they inherit the right aesthetics. 28.12 must be last because it captures the new steady-state baselines.

---

## 28.1 — Forge Theme (New Built-In)

### What
Add a 6th built-in theme called `forge` — a single-accent ember palette inspired by the `anvil-ui-demo` prototype but refined for the full 26-token system.

### Design Rationale
The demo's ember orange (`#FF7A1F`) is striking but needs refinement for production. The single-accent philosophy is sound — it creates a focused, professional aesthetic. We enhance it with proper surface hierarchy and text legibility.

### Files to Modify

**`packages/tui/src/theme/themes.ts`** — add the theme:

```typescript
forge: makeTheme(
  {
    primary:       "#FF7A1F",   // ember — the single accent
    userText:      "#E4E6EA",   // high-contrast primary text
    assistantText: "#E4E6EA",   // same — roles distinguished by layout, not color
    toolName:      "#E4E6EA",   // tools blend with text; status colors differentiate
    toolRunning:   "#FF7A1F",   // ember spinner
    toolDone:      "#6FD08C",   // soft green
    toolError:     "#FF6B6B",   // soft red
    dim:           "#565C66",   // decoration ONLY — never readable text
    border:        "#3A3F47",   // subtle borders (forge.rule)
    accent:        "#FF7A1F",   // ember
    surface:       "#2A2E33",   // slightly elevated background
  },
  {
    brand:            "#FF7A1F",
    brandDim:         "#A35B1A",  // cooled ember
    surfaceElevated:  "#33373D",
    surfaceActive:    "#3D4249",
    textPrimary:      "#E4E6EA",
    textSecondary:    "#A3AAB4",  // muted but still readable
    textMuted:        "#6B7280",  // between readable and decorative
    textUser:         "#E4E6EA",
    textAssistant:    "#E4E6EA",
    success:          "#6FD08C",
    warning:          "#FFB347",
    error:            "#FF6B6B",
    info:             "#6CB4FF",
    borderFocus:      "#FF7A1F",  // ember glow on focus
    separator:        "#3A3F47",
  }
),
```

Update the `ThemeName` union type to include `"forge"`.

### Watchouts
- **Must not shadow custom themes** — `BUILTINS` set in `packages/tui/src/theme/custom.ts` is derived from `Object.keys(THEMES)`, so it auto-includes `forge`. No separate edit needed.
- **`isThemeName()` already uses `name in THEMES`** — auto-correct.
- **The `textMuted` token** intentionally sits between `textSecondary` and `dim` — this is the forge philosophy of having 3 tiers: `text` (readable), `muted` (secondary readable), `dim` (decorative).

### Tests Required
- Add `forge` to the theme render tests in `packages/tui/src/theme/__tests__/`.
- Verify the custom theme loader rejects `"forge"` as a custom theme name (shadow guard).
- Run visual regression to capture baselines.

### Acceptance Criteria
- [x] `forge` appears in `/theme` picker and renders all component states correctly
- [x] `/theme forge` persists across restarts
- [x] Custom themes named `forge` are rejected with a clear error
- [x] `npm run gate` green

---

## 28.2 — Diff Background Tints

### What
Add subtle `backgroundColor` on `+`/`-` diff lines throughout the UI — permission prompt diffs, DiffModal, and `/diff` branch comparisons.

### Design Rationale
Foreground-only coloring makes diffs hard to scan in long files. Background tints (as seen in GitHub, VS Code, and the demo) create visual "lanes" that guide the eye. The tints must be theme-derived, not hardcoded.

### Files to Modify

**`packages/tui/src/diff/colorizeDiff.tsx`** — add `backgroundColor` to addition/deletion `<Text>` elements:
- Additions: `backgroundColor={theme.colors.success}` at ~15% opacity. Since Ink doesn't support opacity, approximate by choosing a dark tint: derive from the theme's `success` color darkened to ~20% luminance.
- Deletions: Same treatment with `error`.

**`packages/tui/src/theme/themes.ts`** — add 2 new semantic color keys:

```typescript
// Add to SemanticColorKey union:
| "diffAddBg" | "diffDelBg"

// Add to SEMANTIC_DERIVATION:
diffAddBg: "toolDone",    // derived from success green
diffDelBg: "toolError",   // derived from error red

// Override in built-in themes with proper dark tints:
// dark:    diffAddBg: "#1B3322", diffDelBg: "#331B1B"
// light:   diffAddBg: "#D4EDDA", diffDelBg: "#F8D7DA"
// forge:   diffAddBg: "#1B3322", diffDelBg: "#331B1B"
// etc.
```

### Watchouts
- **Terminal compatibility**: Not all terminals support `backgroundColor` on `<Text>`. Test on: iTerm2, WezTerm, Kitty, Windows Terminal, plain xterm, tmux. If a terminal doesn't support it, the text still renders — it just lacks the background. This is graceful degradation, not a blocker.
- **Gate compliance**: The new color keys are semantic overrides. The `resolveThemeColors` function already handles missing semantic keys by deriving from legacy keys. Old custom themes will get the derivation automatically.
- **`SideBySideDiff.tsx`** also needs the tints — check if it uses `colorizeDiff` or has its own rendering.
- **AnyColorKey union must be updated** — it's `LegacyColorKey | SemanticColorKey`, so adding to `SemanticColorKey` auto-propagates.

### Tests Required
- Unit test that diff background colors resolve correctly for all 6 themes.
- Visual regression captures showing tinted diffs.

### Acceptance Criteria
- [x] `+` lines have a subtle green-tinted background in DiffModal
- [x] `-` lines have a subtle red-tinted background in DiffModal
- [x] Permission prompt diff preview shows the tints
- [x] Tints are theme-derived, not hardcoded (gate-enforced)
- [x] Custom themes without the new keys get sensible derivations
- [x] `npm run gate` green

---

## 28.3 — Tool Call Timing Metadata

### What
Display execution duration on completed tool calls: `✓ edit_file src/auth.ts 0.4s`.

### Design Rationale
Users want to know which tools are slow. **Correction (verified 2026-09-26):** the elapsed time was already *computed* in core's orchestrator, but only for the **ledger** — the `tool_finished` event carried no timing, so 28.3 added an execution-only `durationMs` to the event. It is deliberately not the ledger's `elapsedMs`, which starts at classification and so includes the permission-prompt wait (see the `AgentEvent` comment).

### Files to Modify

**`packages/tui/src/hooks/useAgentController.ts`** (or `eventReducer.ts`) — capture `durationMs` from `tool_finished` events and store it on `DisplayToolCall`.

**`packages/tui/src/hooks/useAgentController.ts`** — extend `DisplayToolCall` interface:
```typescript
interface DisplayToolCall {
  // existing fields...
  durationMs?: number;  // from tool_finished event
}
```

**`packages/tui/src/components/ToolCallView.tsx`** — render duration:
```typescript
// After the curtailed line, if durationMs is available:
const durationText = call.durationMs !== undefined
  ? call.durationMs >= 1000
    ? `${(call.durationMs / 1000).toFixed(1)}s`
    : `${call.durationMs}ms`
  : "";
// Append in dim text after the tool summary
```

### Watchouts
- **`DisplayToolCall` is a display DTO** — verify the `tool_finished` event in `@anvil/core` already carries timing. Check `agent/session.ts` for the `AgentEvent` type.
- **Row width budget** — the timing text must be included in the `curtail` budget to prevent line wrapping. The current `curtail(line, columns - 4)` needs to account for the ` 0.4s` suffix.
- **Running tools have no duration** — only show on `status === "done"` or `status === "error"`.

### Tests Required
- Unit test in `eventReducer.test.ts` verifying duration propagation.
- Visual test showing timing on completed tools.

### Acceptance Criteria
- [x] Completed tool calls show duration in dim text (e.g. `0.4s`, `1.2s`, `234ms`)
- [x] Running tools show no duration
- [x] Duration fits within the terminal width budget (no line wrapping)
- [x] `npm run gate` green

---

## 28.4 — Thinking Elapsed Indicator

### What
Replace the static `thinking…` text with an elapsed timer: `✻ thinking 4s`.

### Design Rationale
Users staring at a blank response need to know the model is working and how long it's been. A live timer provides that reassurance. The `✻` glyph (from the demo) is more distinctive than `●` and reads as "processing/computation".

### Files to Modify

**`packages/tui/src/components/MessageView.tsx`** — in the streaming block where `message.text` is empty:

Replace:
```tsx
<Text dimColor> thinking…</Text>
```

With a `ThinkingTimer` inline component:
```tsx
function ThinkingTimer() {
  const theme = useTheme();
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(id);
  }, []);
  const label = elapsed > 0 ? ` thinking ${elapsed}s` : " thinking…";
  return <Text color={theme.colors.textMuted}>{label}</Text>;
}
```

The `✻` replaces the pulse spinner character for this specific state:
```tsx
{message.toolCalls.length === 0 && (
  <>
    <Text color={theme.colors.accent}>✻</Text>
    <ThinkingTimer />
  </>
)}
```

### Watchouts
- **`setInterval` in a component** — must clean up on unmount. The `useEffect` return handles this.
- **Timer starts on mount** — if a message toggles between text/no-text states rapidly, the timer resets. This is correct behavior.
- **The glyph `✻`** — verify it renders in all target terminals. It's U+273B (TEARDROP-SPOKED ASTERISK), part of the Dingbats block. Wide terminal support. Fallback: use `*` in `ANVIL_ASCII=1` mode.
- **Hooks must be above the early returns** — the thinking timer hook must execute even when not rendered, or be moved into a stable position. Safest: make it a child component.

### Tests Required
- Unit test: `ThinkingTimer` renders `thinking…` initially, then `thinking 1s` after 1 second.
- Integration test: `MessageView` renders the timer when `streaming && !text && !toolCalls`.

### Acceptance Criteria
- [x] Streaming messages with no text show `✻ thinking 3s` (timer counts up)
- [x] Timer resets when text starts arriving
- [ ] `✻` renders correctly on iTerm2, WezTerm, Kitty, and xterm *(pending: needs a real-terminal pass; vitest cannot assert this. `ANVIL_ASCII=1` fallback exists and is documented)*
- [x] `npm run gate` green

---

## 28.5 — Animated Wordmark Empty State

### What
Replace the static `EmptyState` with an animated pixel-art wordmark that plays a heat-ramp animation on boot, then settles into command hints.

### Design Rationale
The demo's wordmark is visually striking. We refine it by: (a) keeping the onboarding hints below the settled wordmark, (b) making the animation skip-able and respecting `NO_COLOR`/`ANVIL_NO_ANIM`, (c) using theme-derived colors.

### Files to Create

**`packages/tui/src/components/Wordmark.tsx`** — the pixel-art renderer:
- Port the `WORDMARK` pixel grid, `isDot()`, `arrival()`, `getK()`, `renderWordmarkRuns()` functions from the demo.
- Replace hardcoded `forge.heat` colors with a **theme-derived heat ramp**: `[theme.colors.textMuted, theme.colors.warning, theme.colors.accent, theme.colors.brand, theme.colors.textPrimary]`.
- The spark colors: `theme.colors.textPrimary` (flash) and `theme.colors.brand` (core).
- Half-block rendering (`▀▄█`) with `<Text color={fg} backgroundColor={bg}>`.
- Export `WordmarkAnimation` component with `onSettled` callback.

### Files to Modify

**`packages/tui/src/components/MessageList.tsx`** — update `EmptyState`:
- Phase 1 (t < 1800ms): Show `<WordmarkAnimation>` centered.
- Phase 2 (settled): Show the settled wordmark (steel/brand colors) + the existing command hints below.
- Respect `NO_COLOR`, `ANVIL_NO_ANIM=1`, `!isTTY`, and `rows < 16 || cols < 34` — show plain text fallback.

**`packages/tui/src/theme/themes.ts`** — NO changes needed. The animation derives colors from existing theme tokens (`brand`, `accent`, `warning`, `textPrimary`, `textMuted`). Each theme produces a different heat ramp automatically.

### Watchouts
- **`setInterval` at 50ms for animation** — this is heavy. Must clean up on unmount AND when the animation completes. Use a `useRef` for the interval ID.
- **Ink 5 re-render cost** — 50ms intervals mean 20 renders/second during the 1.8s animation. This is acceptable for a short boot animation but would be disastrous if left running. Hard stop at 1800ms.
- **The `marginTop: -2` in the demo** — Ink 5 doesn't support negative margins. Use `justifyContent: "center"` instead.
- **Half-block `backgroundColor`** — critical for the wordmark. Test across terminals. If a terminal doesn't support it, the wordmark degrades to foreground-only (still readable, just not as pretty).
- **Animation must NOT play when resuming a session** — check `messages.length === 0` before mounting the animated state.
- **The existing hints (`/help`, `/model`, `/session`, `/connect`) must remain visible** — they're crucial for onboarding. Show them below the settled wordmark.

### Constants to Add

**`packages/core/src/config/constants.ts`**:
```typescript
export const WORDMARK_ANIM_DURATION_MS = 1800;
export const WORDMARK_ANIM_FRAME_MS = 50;
export const WORDMARK_SPARK_DELAY_MS = 80;
export const WORDMARK_LETTER_START_MS = 250;
export const WORDMARK_COOL_DURATION_MS = 700;
```

### Tests Required
- Unit test: `Wordmark` renders correct dimensions (30×5 half-block rows).
- Unit test: animation settles after `WORDMARK_ANIM_DURATION_MS`.
- Unit test: fallback renders for `cols < 34`, `rows < 16`, `NO_COLOR`, `ANVIL_NO_ANIM`.
- Unit test: EmptyState shows hints after animation settles.
- Visual regression: capture settled wordmark state for all 6 themes.

### Acceptance Criteria
- [x] Boot shows animated wordmark radiating from the dot of the "i"
- [x] Animation settles in ~1.8s and shows command hints below
- [ ] Any keypress skips the animation instantly *(pending: `useInput` needs a real TTY; the `skipAnimation` static path IS tested, the live keypress path is not)*
- [x] `NO_COLOR=1` → plain text "anvil" with version
- [x] `ANVIL_NO_ANIM=1` → settled wordmark immediately (no animation)
- [x] Terminal < 34 cols or < 16 rows → text fallback
- [x] Each theme produces a visually distinct heat ramp
- [x] Session resume (messages > 0) never shows the animation
- [x] `npm run gate` green

---

## 28.6 — Thin Meter Variant & Theme-Selectable Meters

### What
Add a `thinMeter()` function using `━`/`─` (bold/regular horizontal rules) alongside the existing `meter()` using `█`/`░`. Make meter style selectable per theme.

### Files to Modify

**`packages/tui/src/util/chrome.ts`**:
```typescript
export type MeterStyle = "block" | "thin";

export function thinMeter(fraction: number, width: number): string {
  const clamped = Math.min(1, Math.max(0, fraction));
  const filled = Math.round(clamped * width);
  return "━".repeat(filled) + "─".repeat(Math.max(0, width - filled));
}
```

**`packages/tui/src/theme/themes.ts`** — add optional `meterStyle` to `ThemeTypography` or a new `ThemeChrome` section:
```typescript
export interface ThemeChrome {
  meterStyle: MeterStyle;
}
```

Add `chrome: ThemeChrome` to `Theme`. Default: `{ meterStyle: "block" }`. Override in `forge`: `{ meterStyle: "thin" }`.

**`packages/tui/src/components/ContextGauge.tsx`** and **`StatusBar.tsx`** — read `theme.chrome.meterStyle` and call the appropriate meter function.

### Watchouts
- **Adding a field to `Theme`** — custom themes that don't specify `chrome` need a default. Handle in `custom.ts` loader the same way `spacing`/`borders` are handled (defaulted if missing).
- **`gaugeDisplayText()` is a pure function used for width budgeting** — it must use the same meter function as the render path. Pass `meterStyle` as an argument.

### Acceptance Criteria
- [x] `forge` theme uses thin meter (`━──────────`)
- [x] Other themes use block meter (`██████░░░░`) by default
- [x] Custom themes can override `chrome.meterStyle`
- [x] `npm run gate` green

---

## 28.7 — Compact Permission Prompt (Inline Mode)

### What
For non-file-edit tools (`run_command`, MCP tools), offer a compact single-line inline permission prompt alongside the existing full modal.

### Design Rationale
The full modal with 3 bordered buttons is appropriate for file edits (where the diff preview is essential). For shell commands and MCP tools, it's overkill — a quick `y/a/n` inline bar is faster and less disruptive.

### Files to Modify

**`packages/tui/src/components/PermissionPrompt.tsx`**:
- Add a `compact` boolean derived from `!DIFF_TOOLS.has(request.toolName)`.
- When `compact`:
```tsx
<Box borderStyle={theme.borders.panel} borderColor={theme.colors.warning} paddingX={1}>
  <Text>
    <Text color={theme.colors.accent}>❯ </Text>
    <Text color={theme.colors.textPrimary}>{label}? </Text>
    <Text color={theme.colors.textPrimary} bold>y</Text>
    <Text color={theme.colors.textSecondary}> allow · </Text>
    <Text color={theme.colors.textPrimary} bold>a</Text>
    <Text color={theme.colors.textSecondary}> always · </Text>
    <Text color={theme.colors.textPrimary} bold>n</Text>
    <Text color={theme.colors.textSecondary}> deny</Text>
  </Text>
</Box>
```
- Add `y`/`a`/`n` keybindings to the `useInput` handler (only when compact).
- The full modal path remains unchanged for `edit_file`/`write_file`.

### Watchouts
- **The command summary must still be visible** — show it as a dim line above the inline bar: `run_command: npm test`.
- **MCP tools must still show the server warning** — "External process — anything sent is visible to that server."
- **The `y/a/n` keybindings must NOT conflict with text input** — the InputBar is unmounted while PermissionPrompt is mounted, so there's no conflict. Safe.
- **Esc still = Deny** — the universal overlay contract.

### Tests Required
- Unit test: compact mode renders for `run_command`, full modal for `edit_file`.
- Unit test: `y` key resolves true, `n` resolves false, `a` approves always.
- Unit test: MCP tools show server warning even in compact mode.

### Acceptance Criteria
- [x] `run_command` shows single-line prompt with `y/a/n` keybindings
- [x] `edit_file`/`write_file` still shows full modal with diff preview
- [x] MCP tools show server identity warning in compact mode
- [x] Esc = Deny in both modes
- [x] `npm run gate` green

---

## 28.8 — Muted vs Dim Token Refinement

### What
Audit and fix all components that use `dim` (decorative) where they should use `textSecondary` or `textMuted` (readable). The forge philosophy: **dim is never for readable text**.

### Design Rationale
Currently, Anvil uses `dimColor` (Ink's native prop) and `theme.colors.dim` interchangeably for both decorative elements AND secondary text. This works on `dark` theme (gray is readable on black) but fails on themes where `dim` is intentionally low-contrast (forge: `#565C66` on dark background). Text that humans need to read must use `textSecondary` or `textMuted`.

### Files to Audit

Every component in `packages/tui/src/components/` that uses `dimColor` or `theme.colors.dim`:
- `Header.tsx` — labels like `repo:`, `env:`, `tests:` → should use `textSecondary` (readable)
- `StatusBar.tsx` — hints and token counts → should use `textSecondary`
- `MessageList.tsx` — "N earlier messages" → `textSecondary`
- `MessageView.tsx` — timestamps → `textMuted`
- `ToolCallView.tsx` — tool output → `textSecondary`
- `MissionDeck.tsx` — milestone counts → `textSecondary`
- `PermissionPrompt.tsx` — keybinding hints → `textSecondary`
- `DiffModal.tsx` — file kind badges → `textSecondary`
- `ModelPicker.tsx` — section headers → `textSecondary`

**Keep `dimColor`/`dim` for**: horizontal rules (`Divider`), decorative `│` separators, border colors, and purely ornamental elements.

### Watchouts
- **`dimColor` is an Ink built-in prop** — it's not theme-aware. It literally sets the ANSI "dim" attribute. Replace with explicit `color={theme.colors.textSecondary}` for readable text.
- **This is a large diff** — do it in one focused pass across all components. Don't mix with other changes.
- **Existing tests may assert on `dimColor`** — update test expectations.
- **Do NOT change the `Divider` component** — it's purely decorative and should stay dim.

### Acceptance Criteria
- [x] All readable text uses `textSecondary` or `textMuted`
- [x] All decorative elements (rules, separators, ornaments) use `dim` or `dimColor`
- [x] The forge theme renders all text legibly (no text at `#565C66` on dark background that humans need to read)
- [x] `npm run gate` green

---

## 28.9 — Header Session Title & Turn Counter

### What
Show the session title (if named) and cumulative turn count in the header.

### Design Rationale
In long sessions, users lose track of which session they're in and how many turns they've used. The header has room (especially at ≥ 120 cols).

### Files to Modify

**`packages/tui/src/components/App.tsx`** — pass session title and turn count to Header:
```tsx
<Header model={currentModel} isBusy={isBusy} context={situationalContext}
        sessionTitle={session.sessionTitle} turnCount={messages.filter(m => m.role === "user").length} />
```

**`packages/tui/src/components/Header.tsx`** — add `sessionTitle` and `turnCount` props:
- Show title after brand: `▲ ANVIL · "refactor auth"` (if named)
- Show turn count in the model tag area: `Gemini · 12 turns · idle`
- Responsive: only show at ≥ 105 cols (drop tests segment first)

### Watchouts
- **Session title may be undefined** — only show if set.
- **Turn count from `messages` array** — count only `role === "user"` messages.
- **Width budgeting** — the header already does precise `leftWidth()` computation. Add these segments into the same budget system.

### Acceptance Criteria
- [x] Named sessions show title in header
- [x] Turn count visible at ≥ 105 cols *(rides the model tag, which `fitTag` degrades first when the budget is tight — the existing no-wrap guarantee)*
- [x] Unnamed sessions show no title (no empty quotes)
- [x] `npm run gate` green

---

## 28.10 — Message Cost Annotations

### What
Show per-turn token cost in dim text on settled assistant messages (when `/expand` is active).

### Design Rationale
Users on paid models want to see cost accumulation. The data is available from core's usage tracking but never surfaced per-message.

### Files to Modify

**`packages/tui/src/hooks/useAgentController.ts`** — extend `DisplayMessage` with `inputTokens` and `outputTokens` fields, populated from `turn_complete` events.

**`packages/tui/src/components/MessageView.tsx`** — when `expandTools` is true and message has token data:
```tsx
{expandTools && message.inputTokens !== undefined && (
  <Text color={theme.colors.textMuted}>
    {fmt(message.inputTokens)} in · {fmt(message.outputTokens)} out
  </Text>
)}
```

### Watchouts
- **Token data may not be available on resumed sessions** — gracefully omit.
- **Only show when `/expand` is active** — don't clutter the default view.
- **Check if `turn_complete` or `stream_end` events carry per-turn token counts** — the existing `usage` in `useAgentController` is cumulative. Per-turn data may need delta calculation.

### Acceptance Criteria
- [x] `/expand` shows per-turn token counts on settled assistant messages
- [x] Default (compact) view shows no token counts
- [x] Resumed sessions gracefully omit missing data
- [x] `npm run gate` green

---

## 28.11 — Code Block Line Numbers

### What
Add line numbers to syntax-highlighted code blocks in `MarkdownView`.

### Files to Modify

**`packages/tui/src/markdown/MarkdownView.tsx`** or **`renderMarkdown.ts`** — when rendering a code fence with content:
- Prepend line numbers in `textMuted` color: `  1 │ const x = 42;`
- Right-align numbers to the widest line number width.
- Only show line numbers when the code block has ≥ 3 lines (single-line snippets don't need them).

### Watchouts
- **Line numbers add 5-6 characters per line** — adjust the effective width for syntax highlighting.
- **The `startLine` metadata in code fences** (`\`\`\`typescript:src/auth.ts#L24`) — if present, start numbering from that line.
- **Performance** — code blocks are rendered once (settled text only, not during streaming). No performance concern.

### Acceptance Criteria
- [x] Code blocks with ≥ 3 lines show line numbers
- [x] Line numbers are right-aligned and use `textMuted` color
- [x] `npm run gate` green

---

## 28.12 — Visual Regression Baseline Refresh

### What
Regenerate all visual regression baselines after the above changes land.

### What (corrected 2026-09-26 — see the harness note below)
Add `forge` to the **PNG pixel-matrix** so the 6th theme has rendered baselines,
and confirm the whole matrix still passes.

### Two harnesses — this task is about the SECOND one

| Harness | Runner | Renders | Baselines | Catches |
|---|---|---|---|---|
| Text frames | `npm run visual` (vitest `__visual__/visual.test.tsx`) | `THEMES.dark` only, ANSI-stripped | `*.txt` | layout/shape regressions (line stacking, wrapping, truncation) |
| **PNG matrix** | `npm run visual:capture` → `visual:diff` | **every theme in `THEME_LIST`**, full colour | `<theme>-<WxH>/*.png` | **colour** regressions, per-theme rendering |

This distinction was missing from the original task, which said "regenerate all PNG
baselines" and then asked for per-theme baselines — impossible from the `.txt`
harness, which is single-theme by design (a per-theme `.txt` capture would be six
byte-identical files). The per-theme criterion belongs to the PNG harness.

### Files to Modify

**`packages/tui/scripts/visual-capture.mjs`** — add `forge` to `THEME_LIST`
(`bg`/`fg` = the theme's own `surface`/`textPrimary`, so the frame background
matches the product). **This is the only file that defines the matrix** — the CI
workflow merely calls `npm run visual:capture` and `npm run visual:diff`, so
adding a theme needs **no** protected-workflow edit. (The workflow's job *label*
still reads "3 sizes x 2 themes"; that is now stale — left untouched deliberately,
as it is a protected artifact and a cosmetic label only. See PROGRESS 2026-09-26.)

**`packages/tui/__visual-baselines__/forge-<WxH>/*.png`** — NEW; 48 frames
(6 sizes × 8 scenarios).

### Procedure (as actually run)
1. `node scripts/visual-capture.mjs` — captures the full 6×3×8 = 144-frame matrix into `__visual-current__/`.
2. Promote **only** the new `forge-*` directories (`cp -r __visual-current__/forge-* __visual-baselines__/`) so the committed `dark`/`highContrast` baselines do not churn.
3. `node scripts/visual-diff.mjs` — all **144** scenarios PASS within 2.5%.
4. Commit the script change + the 48 new baselines.

### Watchouts
- **This MUST be the last task** — all visual changes must be stable before capturing baselines.
- **Adding a third theme** grows the matrix from 12 to 18 configurations (+50% frames). Accepted for a 6th built-in theme.

### Acceptance Criteria
- [x] All visual regression tests pass with updated baselines (144/144 within 2.5%)
- [x] At least `dark`, `highContrast`, and `forge` themes have baselines
- [x] `npm run gate` green

---

## Standing Rules for All Agents

1. **Every color comes from `useTheme()`** — the gate scanner rejects hardcoded color strings in `packages/tui/src/components/`.
2. **Every new constant goes in `packages/core/src/config/constants.ts`** — no magic numbers.
3. **Every new semantic color key requires**: updating `SemanticColorKey` union, `SEMANTIC_DERIVATION` map, `SEMANTIC_COLOR_KEYS` array, and all 6 built-in theme overrides where the derivation default isn't appropriate.
4. **Every new `Theme` field requires**: a default in `makeTheme()` and fallback handling in `packages/tui/src/theme/custom.ts` loader for old custom themes that lack the field.
5. **Build order is sacred**: `npm run build -w @anvil/core && npm run build -w @anvil/tui && npm run build -w @anvil/cli`.
6. **Run `npm run gate` before declaring any task done.** If it fails, you are NOT done.
7. **`@anvil/core` must NEVER import from `@anvil/tui` or `@anvil/cli`** — even for type-only imports.
8. **Use `getErrorMessage(err)` from `@anvil/core`** — never `err instanceof Error ? err.message : String(err)`.
9. **Components handle compact width (< 80 cols)** — nothing breaks below 60 columns.
10. **Overlays own the keyboard exclusively** — InputBar is unmounted while any modal is mounted.

---

## Verification Gate (Run After Every Task)

```bash
npm run gate
```

If the gate fails, fix the issue before moving to the next task. The gate runs:
- Step 0: Gate sensor self-test
- Step 0.5: Protected-artifact integrity manifest check
- Step 1: Diff slop & boundary scanner
- Step 1.5: Residual slop drain scan (full tree)
- Step 2: Monorepo sequential build
- Step 3: TypeScript typecheck
- Step 4: Unit tests (788+)
- Step 5: Fast mock eval benchmark

**Definition of Done:** 100% green gate + task acceptance criteria all checked.
