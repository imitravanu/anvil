# PRODUCT POLISH & UI REFINEMENT — ARCHITECTURE RECORD (PHASE 8, WORKSTREAM C)

> Status: **APPROVED** (direction, by client delegation, 2026-09).
> This file is the SINGLE SOURCE OF TRUTH for the UI / product-finish workstream.
> It is written so that any other agent receiving this record ("the token change")
> can execute the plan without re-deriving the product intent.

## 0. AGENT HANDOFF SHEET — read this first

**You are implementing Workstream C only.** Read in order:
1. This file (do not re-derive intent).
2. `docs/PHASE-8-SPEC.md` — Workstreams A (durable loop) + B (free-model truth)
   are SEPARATE and may be built in parallel or first; do not mutate their files.
3. `docs/PHASE-3-NOTES.md` / `docs/PHASE-4-NOTES.md` — existing TUI conventions.

**Non-negotiables:**
- Do NOT change any behavior of the agent loop, tool system, providers, or config.
  This workstream is PURELY PRESENTATION + copy + small pure helpers.
- Do NOT add new npm runtime dependencies. (`ink`, `ink-text-input`,
  `cli-highlight`, `react` are the only UI runtime deps and stay that way.)
- Do NOT touch `packages/core/src/**` except to ADD pure helper functions that need
  no provider/session imports. Preference: keep all new helpers in `packages/tui`
  unless a helper must be shared with the CLI.
- Preserve every existing key binding, command, theme name, and session behavior.
- All 97 existing core tests + typecheck (3 packages) must still pass.
- Verify with the commands in section 8 before reporting done. Never report "done"
  without running them.

**Definition of done (all must be true):**
- Every finding F1–F12 in section 2 is addressed by a planned item C1–C7 (mapped in
  section 4).
- `npm run typecheck` clean in all packages.
- `npm test` (core) still green.
- `npm run build` succeeds (the esbuild CLI bundle compiles the TUI).
- No file outside the Workstream C file list (section 7) is modified.

---

## 1. VERIFIED CURRENT STATE (FACTS, from source read 2026-09)

- **Stack (FACT):** React 18 + Ink 5, single `App` component composing 10 small
  components (`Header`, `MessageList`, `MessageView`, `InputBar`, `StatusBar`,
  `ToolCallView`, `ModelPicker`, `SessionPicker`, `PermissionPrompt`,
  `FirstRunSetup`) plus theme (`theme.ts`, `themes.ts`), diff colorizer
  (`diff/colorizeDiff.tsx`), and a code-block highlighter
  (`markdown/highlightCodeBlocks.ts`).
- **Theming (FACT):** 3 flat themes (`dark`, `light`, `highContrast`) exposing ~10
  named ANSI colors + 1 spacing token. No accent/surface semantics; the `border`
  color is now barely used (Phase 7 changed InputBar to primary/dim).
- **Markdown (FACT):** `highlightCodeBlocks` is a single regex pass over fences
  using `cli-highlight`. Inline markdown (bold/italic/inline code/headings/lists/
  quotes/links) is NOT rendered — plain text passthrough.
- **State visibility (FACT):** Header shows `▲ ANVIL` + raw `model` id + busy/idle.
  StatusBar shows raw `model` + [FREE] + static ● + cumulative tokens + hints, all
  left-aligned in ONE row. No provider display name is shown anywhere outside the
  pickers/overlays.
- **Raw ids leaked to chrome (FACT):** `Header`, `StatusBar`, `SessionPicker`
  (`model`), and EmptyState all render the registry `id` (e.g. `google/gemma-4-...`)
  not `displayName`.
- **Streaming affordances (FACT):** `ToolCallView` has an animated spinner;
  `StatusBar` busy dot is static; streaming assistant text uses only the
  assistant color.
- **Empty state (FACT):** `MessageList` EmptyState suggests `/help /model /session`
  but not `/connect`; shows raw model id; no version.
- **First-run (FACT):** two-step list -> masked key input -> "saved. Press Enter."
  No brand framing, no per-provider checkmark state.
- **Permission prompt (FACT):** label is `"wants to ${tool.replace('_',' ')}"`
  -> e.g. "wants to edit file" for edit_file; diff shown inline via ColorizedDiff.

## 2. FINDINGS — why it does not feel finished (severity H/M/L)

- **F1 (H)** Raw model ids in Header/Status/Empty/SessionPicker — feels like dev
  tooling, not a product. Fix: show `displayName` (+ provider label) in chrome.
- **F2 (H)** No inline markdown — the single biggest "unfinished" signal for an AI
  chat app: bold/code/headings etc. are blind. Fix: pure markdown renderer (C2).
- **F3 (M)** Header/StatusBar have no truncation — a long model id or plan can push
  hints off-screen on narrow terminals. Fix: width-budgeted truncate helpers (C3).
- **F4 (M)** Provider label never shown in chrome; user can't tell which backend a
  [FREE] model runs on. Fix: resolve displayName + provider label (C1).
- **F5 (M)** Static busy dot; streaming affordance weak outside ToolCallView.
  Fix: busy state in StatusBar (C4).
- **F6 (M)** Empty state incomplete (no /connect; raw model id). Fix: (C4).
- **F7 (L)** First-run plain; no progress/check state; no brand. Fix: copy +
  checkmarks (C5).
- **F8 (L)** Permission copy "wants to edit file" awkward; options repeat the tool
  name. Fix: active phrasing (C5).
- **F9 (M)** Zero TUI tests -> refactors risk regressing the chrome. Amendment
  below adds pure-function tests only (C7).
- **F10 (L)** Theme system shallow; `border` unused; no surface/accent semantics.
  Fix: optional new theme tokens, back-compatible (C6).
- **F11 (L)** Help/CLI have no subcommand examples. Fix: copy (C5).
- **F12 (L)** No version in app UI. Fix: footer/empty-state (C1/C4).

## 3. WHAT "FINISHED" MEANS — the polish bar (product definition)

A user should be able to, at a glance and with zero loss of info:
1. Know what model/provider is active and whether it is free (chrome, not pickers only).
2. Read assistant output with the structure the model intended (markdown).
3. Never see truncated or clipped text on a normal (>= 100 col) terminal.
4. Tell whether Anvil is working, streaming, or idle.
5. Remember how to get help (empty state, hints, /help examples).
6. Configure providers on first run without feeling like a developer form.
7. Never see a raw model id in persistent chrome.

## 4. PLAN — Workstream C micro-milestones (each independently verifiable)

### C1 — Identity & chrome helpers (fixes F1, F4, F12)
- New `packages/tui/src/util/labels.ts` (single source of truth, moved from App):
  `export const PROVIDER_LABELS: Record<string, string>` (Anthropic, OpenAI, Google
  Gemini, OpenRouter, Groq, GitHub Models, Cerebras, Mistral AI, Ollama).
- New `packages/tui/src/util/format.ts` (pure):
  - `displayModelLabel(modelId: string): string` — MODEL_REGISTRY displayName, fallback to id.
  - `providerLabel(providerId: string): string` — from PROVIDER_LABELS, fallback to id.
  - `curtail(text: string, max: number): string` — code-point-aware truncation with "…";
    uses `Array.from(text)` (never `text.length` — CJK/emoji safety).
- Header: `provider / displayName [FREE]` replaces the raw id; still shows busy/idle.
- StatusBar: same label helper; tokens; hints move to a right-aligned zone (C3).
- EmptyState: uses displayModelLabel + providerLabel + version footer (C4).
- SessionPicker rows: `curtail(title, 40)` + `displayModelLabel(model)`.
- Version: import `CORE_VERSION` from `@anvil/core`; show in EmptyState and /help.

### C2 — Minimal, safe markdown renderer (fixes F2)
- New `packages/tui/src/markdown/renderMarkdown.ts` (pure function, NO React):
  - `parseMarkdownText(text): MarkdownBlock[]`; block kinds:
    `heading{level}`, `text`, `list`, `quote`, `code{language}`, `hr`.
  - Inline spans on text blocks: `**bold**`, `*italic*`, `` `code` ``, `***both***`.
    Deliberately NOT supported this cycle: links, images, tables, strikethrough,
    HTML (escaped to visible text).
  - Code fences pass through raw (the existing second-pass `highlightCodeBlocks`
    does syntax highlighting at render time — keep that).
- New `packages/tui/src/markdown/MarkdownView.tsx` (Ink): maps blocks to colored
  lines; code blocks highlighted via existing `highlightCodeBlocks`.
- `MessageView` uses `MarkdownView` for completed (non-streaming) assistant text;
  streaming text stays plain (no mid-stream flicker — same "second pass" rule).
- Tests: `packages/tui/src/markdown/__tests__/renderMarkdown.test.ts` (pure).

### C3 — Layout robustness (fixes F3)
- `curtail()` applied to Header model/provider line and EmptyState.
- StatusBar becomes two zones using the known console width (`useStdout`):
  left = labels + tokens; right = hint text. When the budget can't fit hints, hide
  hints rather than clipping (never wrap, never overflow the pane).
- SessionPicker title truncated via `curtail`.

### C4 — State affordances (fixes F5, F6)
- Extract `useSpinnerFrame` from `ToolCallView.tsx` into `util/useSpinner.ts`
  (pure refactor; ToolCallView behavior unchanged) and reuse it for a StatusBar
  busy indicator (spinner next to "busy") and a streaming caret on an in-stream
  assistant line.
- EmptyState full brand block: ▲ ANVIL / "Terminal coding agent" / provider·model
  line / "Try: /help · /model · /session · /connect" / "v{CORE_VERSION}".

### C5 — Copy & microcopy (fixes F7, F8, F11)
- `FirstRunSetup`: add step indicator "Step 1 of 2 / Step 2 of 2"; on save show
  "✓ API key saved — add more or press Enter to continue".
- `PermissionPrompt` label map:
  `edit_file -> "wants to edit a file"`, `write_file -> "wants to write a file"`,
  `run_command -> "wants to run a command"`, default `wants to ${tool.replace(/_/g, ' ')}`.
  (Options text stays: Allow once / Always allow '<tool>' this session / Deny.)
- `/help` retains list but adds one usage example per command:
  `/session resume [id] — no id opens the picker`.

### C6 — Theme depth (fixes F10)
- Extend the `Theme` type with required tokens: `accent` and `surface` and
  document per-theme values (dark: accent cyan, surface gray-dim; light:
  accent blue, surface gray; highContrast: accent yellowBright, surface white).
- Use: outer app frame border = `border`; InputBar idle = `accent` (per current
  intent), busy = `dim`; StatusBar busy spinner = `accent`; permission borders
  stay `toolRunning`. All existing theme names/keys preserved (no breaking change).

### C7 — Pure-function test seed (fixes F9) — AMENDMENT to PHASE-8-SPEC
- Adds to `packages/tui/package.json`: `"test": "vitest run"` + `vitest`
  devDependency (version matched to `@anvil/core`'s).
- Tests ONLY pure helpers: `renderMarkdown`, `curtail`, `displayModelLabel`,
  `providerLabel`. NO component/interaction/snapshot infra this cycle.
- This amends the PHASE-8-SPEC non-goal "NO new TUI test infra" to:
  "pure-function unit tests in the TUI package are permitted; component and
  interaction test infra remains a later-phase item." See section 12 (change log).

## 5. SCOPE / NON-OSCOPE

**In scope:** presentation, copy, layout, theming tokens, pure helpers, the pure
helper tests above, and the two tiny component changes that consume them.
**Explicitly OUT of scope (do NOT do):**
- No changes to AgentSession, tools, providers, config, sessions, compaction.
- No new slash commands, no new key bindings.
- No new markdown features beyond C2's list.
- No package.json dependency changes except `vitest` devDependency in `@anvil/tui`.
- No rewriting of App's architecture or state flow.

## 6. INTERFACES / CONTRACTS (exact)

### New files
```ts
// packages/tui/src/util/labels.ts
export const PROVIDER_LABELS: Record<string, string>;
// values: anthropic->Anthropic, openai->OpenAI, gemini->Google Gemini,
// openrouter->OpenRouter, groq->Groq, github->GitHub Models,
// cerebras->Cerebras, mistral->Mistral AI, ollama->Ollama

// packages/tui/src/util/format.ts
export function displayModelLabel(modelId: string): string; // registry displayName fallback id
export function providerLabel(providerId: string): string; // PROVIDER_LABELS fallback id
export function curtail(text: string, max: number): string; // code-point aware + "…"

// packages/tui/src/util/useSpinner.ts
export const SPINNER_FRAMES: readonly string[];            // moved from ToolCallView
export function useSpinnerFrame(active: boolean): string;  // moved from ToolCallView

// packages/tui/src/markdown/renderMarkdown.ts
export type MarkdownSpan = { text: string; bold?: boolean; italic?: boolean; code?: boolean };
export type MarkdownBlock =
  | { kind: "heading"; level: number; spans: MarkdownSpan[] }
  | { kind: "text"; spans: MarkdownSpan[] }
  | { kind: "list"; spans: MarkdownSpan[] }
  | { kind: "quote"; spans: MarkdownSpan[]; depth: number }
  | { kind: "code"; language: string; code: string }
  | { kind: "hr" };
export function parseMarkdownText(text: string): MarkdownBlock[];

// packages/tui/src/markdown/MarkdownView.tsx
export function MarkdownView({ blocks }: { blocks: MarkdownBlock[] }): JSX.Element;
```

### Modified files (minimal)
- `components/Header.tsx` — consume labels/curtail; props unchanged `{model, isBusy}`.
- `components/StatusBar.tsx` — consume labels/curtail/useSpinner; two-zone layout.
- `components/MessageList.tsx` — EmptyState uses labels + version (needs `model`
  already passed; add nothing else).
- `components/MessageView.tsx` — completed assistant text via `MarkdownView`.
- `components/SessionPicker.tsx` — `curtail(title, 40)` + `displayModelLabel`.
- `components/FirstRunSetup.tsx` — step indicator + saved copy (copy only).
- `components/PermissionPrompt.tsx` — label map (copy only).
- `commands/registry.ts` — `/help` examples (copy only).
- `components/App.tsx` — import `PROVIDER_LABELS` from util (dedupe), pass nothing
  new to children beyond what exists; use `theme.colors.border` for outer frame;
  read `CORE_VERSION` for EmptyState (via MessageList model/version prop or import).;
- `theme/themes.ts` + `theme/theme.ts` — add `accent` and `surface` tokens to all 3
  themes (required on the type).
- `components/ToolCallView.tsx` — import spinner from util (behavior unchanged).

### New tests
- `packages/tui/src/markdown/__tests__/renderMarkdown.test.ts`
- `packages/tui/src/util/__tests__/format.test.ts`
- `packages/tui/package.json` — `"test": "vitest run"`; devDependency `vitest`
  (version = same as `@anvil/core`'s).

## 7. FULL WORKSTREAM C FILE LIST (allowlist — no other files may change)

```
NEW:
  packages/tui/src/util/labels.ts
  packages/tui/src/util/format.ts
  packages/tui/src/util/useSpinner.ts
  packages/tui/src/markdown/renderMarkdown.ts
  packages/tui/src/markdown/MarkdownView.tsx
  packages/tui/src/markdown/__tests__/renderMarkdown.test.ts
  packages/tui/src/util/__tests__/format.test.ts
MODIFIED:
  packages/tui/src/components/Header.tsx
  packages/tui/src/components/StatusBar.tsx
  packages/tui/src/components/MessageList.tsx
  packages/tui/src/components/MessageView.tsx
  packages/tui/src/components/SessionPicker.tsx
  packages/tui/src/components/FirstRunSetup.tsx
  packages/tui/src/components/PermissionPrompt.tsx
  packages/tui/src/components/ToolCallView.tsx
  packages/tui/src/components/App.tsx
  packages/tui/src/commands/registry.ts
  packages/tui/src/theme/themes.ts
  packages/tui/src/theme/theme.ts
  packages/tui/package.json   <- (add test script + vitest devDep only)
```

## 8. VERIFICATION (run these exactly, in order, before reporting done)

```bash
cd /home/mitravanu/Projects/anvil
npm run typecheck                       # must be clean in core, tui, cli
npm test -w @anvil/core                 # must stay 97/97 green
npm test -w @anvil/tui                  # NEW: pure-helper tests pass
npm run build                           # esbuild CLI bundle must succeed
git status --porcelain                  # diff MUST match section 7 allowlist
```

Manual smoke checklist (interactive, optional for the implementing agent but REQUIRED
for the review):
- `npm run dev` boots to EmptyState: brand block, provider·model labels (no raw ids),
  version line, suggestions incl. `/connect`.
- `/` menu, `/help` (examples), send a message containing `**bold**` and a code fence —
  bold renders, fence highlights, streaming text stays plain.
- Busy state shows an animated indicator; hints stay on-screen at 100 cols and hide at
  60 cols instead of clipping.
- Narrow terminal (-c 60) never overflows the frame.

## 9. SEQUENCING (implement in this order — each step keeps typecheck green)

1. `format.ts` + `labels.ts` + tests -> 2. `useSpinner.ts` move (refactor, no behavior
   change) -> 3. theme tokens (`themes.ts`/`theme.ts`) -> 4. Header/StatusBar/EmptyState
   label+curtail consumption -> 5. `renderMarkdown.ts` + tests -> 6. `MarkdownView.tsx` +
   `MessageView` wiring -> 7. copy items (FirstRun/Permission/help) -> 8. SessionPicker
   polish -> 9. full verification (section 8).

## 10. KNOWN GOTCHAS (learned reading the source)

- `MessageView` must only pass COMPLETED assistant text to `MarkdownView` — streaming
  text goes through the plain path (Phase 3's "second-pass" rule; prevents fence flicker).
- Ink boxes do NOT wrap: overflow truncates silently. `curtail` + width budgets are the
  fix; never rely on Ink to wrap.
- `useStdout().columns` can be undefined on some TTYs — default to 80 and never throw.
- ANSI already inside `highlightCodeBlocks` output must NOT be re-parsed by the markdown
  renderer (markdown runs first, then code blocks get highlighted in `MarkdownView`).
- Do not `String.prototype.length`-based truncation — `curtail` must use `Array.from`.
- `PROVIDER_LABELS` removal from App.tsx: update the `PROVIDER_LABELS[providerId]` use in
  `handleConnectDone` to import from `util/labels.js` (extension matters: `.js` not `.ts`).
- All imports in this ESM monorepo must use `.js` extensions (NodeNext) — check existing
  files for the pattern.
- Theme type change must keep `Theme = (typeof THEMES)[ThemeName]` derivation intact.

## 11. RISKS & CONTROLS

- **Markdown parser gaps (M):** hand-rolled parser could miss edge cases (nested fences,
  code with `*`). Controls: strictly bounded feature list, pure-function tests, code
  fences excluded from inline parsing.
- **Chrome regression (M):** label changes could break text-derived widths. Controls:
  allowlist, section 8 check, manual smoke.
- **"Finish feels" is subjective (L):** the polish bar (section 3) is the acceptance
  contract — review against it, not taste.
- **Rollback:** single commit per milestone; `git revert` is clean. No data or schema
  changes anywhere in Workstream C.

## 12. DECISION LOG (approved, by client delegation)

| # | Decision | Alternatives rejected | Reason | Trade-off |
|---|----------|------------------------|--------|-----------|
| D1 | Hand-rolled bounded markdown renderer | commonmark lib (markdown-it) | no new runtime deps, exact control, tiny feature set | more parser code to own |
| D2 | Pure helpers + vitest in tui | ink-testing-library snapshots | honors "no new test infra" while making renderer testable | no component-level tests yet |
| D3 | Chrome shows displayName + provider label, never raw model id | show both id+name | polish bar #7 | id hidden (still in picker) |
| D4 | Active phrases for permission labels | keep current | F8 legibility | none |
| D5 | Theme `accent`/`surface` tokens added as required | make optional | single code path, 3 themes controlled | none |
| D6 | StatusBar two-zone with hint-hiding | always print hints | F3 overflow safety | hints absent at very narrow widths |

### Change log (amendment to PHASE-8-SPEC)
- **2026-09-05 — Scope addendum (approved, by delegation):** the client added a UI /
  product-polish requirement to Phase 8. This record defines Workstream C. The
  PHASE-8-SPEC non-goal "NO new TUI test infra" is amended: *pure-function unit tests
  in `@anvil/tui` (vitest) are permitted; component/interaction test infra remains a
  later-phase item.* No other PHASE-8-SPEC decision is altered.

## 13. OPEN QUESTIONS — CLOSED (Phase 8.5, U4)

The three optional preferences were finalized as decisions when the client
approved Phase 8.5: keep the `▲ ANVIL` glyph; keep the 4 empty-state
suggestions (no `/theme` line); `/help` examples render inline. See
`docs/UI-ROADMAP.md` for the live UI roadmap going forward.