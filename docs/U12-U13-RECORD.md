# U12+U13 RECORD — component tests + custom themes (2026-09-05)

> Status: IMPLEMENTED + VERIFIED (gates in §4). Single source of truth for
> this slice. Closes the last two roadmap items (U12, U13) — the UI roadmap
> is now fully done; see `docs/UI-ROADMAP.md`.

## 1. U12 — COMPONENT TEST INFRA

- `ink-testing-library@4.0.0` added as a **devDependency** (no runtime
  impact; the no-new-runtime-deps rule holds).
- `tui/src/test-utils/testRender.tsx`: themed harness (`renderThemed` under
  `THEMES.dark`, so a missing provider can't hide) + `frameText` ANSI
  stripper, both with bounded return types (declaration emit chokes on the
  library's internal class type — recorded gotcha, §3).
- 15 render tests: `components/__tests__/calls.test.tsx` (ToolCallView ×4:
  symbols, collapse/expand, running-never-expands, error; SubAgentView ×3:
  collapsed counts, running hides report, expanded shows it) and
  `components/__tests__/chrome.test.tsx` (ColorizedDiff gutters + row cap,
  Header brand/labels/busy + no-raw-id, PlanLine collapse + blank-null,
  StatusBar tokens/state, MessageView roles + cards).
- Deliberately OUT (still): `useInput` components (InputBar, pickers,
  PermissionPrompt, overlays) — stdin simulation is timing-flaky; their
  logic stays covered via pure helpers (parseCommand, grouping, formatters).
  (SUPERSEDED same-day — see §6. Pickers/overlays remain out; the two
  safety-critical surfaces are now covered.)
- KEY LIMITATION, verified: test stdout is not a TTY, so chalk emits zero
  ANSI codes — **colors/styles are unassertable** in this harness. Tests
  assert structure and text. A visual regression pass still needs eyes.

## 2. U13 — CUSTOM THEMES

- `~/.anvil/themes.json` (ANVIL_HOME-honoring): `{ "<name>": { colors
  (all 12 required, named or hex), spacing? } }`. Names `[a-z0-9-_]{1,24}`,
  built-in shadows rejected. Missing file silent; corrupt/partial files
  report per-entry problems, never throw, never half-load (mcp.json
  conventions).
- `Theme` is now a structural interface (was a literal-union derivation);
  built-ins satisfy it unchanged, customs validate into it. Components
  untouched — they read via `useTheme()` as before (Phase 6 rule holds).
- App resolves built-in → custom → dark fallback; `/theme` with no args
  lists all names plus loader problems; selection persists in settings
  (already a free string — no core changes). CLI validates settings.theme
  against built-ins + customs at boot.
- README documents the file with a full example + rules.

## 3. CHANGES (exact file list)

```
NEW:
  docs/U12-U13-RECORD.md                           # this file
  packages/tui/src/test-utils/testRender.tsx        # ThemedRender harness
  packages/tui/src/components/__tests__/calls.test.tsx   # +7
  packages/tui/src/components/__tests__/chrome.test.tsx  # +8
  packages/tui/src/theme/custom.ts                  # loader/validator
  packages/tui/src/theme/__tests__/custom.test.ts   # +4
MODIFIED:
  packages/tui/package.json (+ ink-testing-library devDep), package-lock.json
  packages/tui/src/index.ts                         # export theme utils for CLI
  packages/tui/src/theme/themes.ts                  # structural Theme + REQUIRED_COLOR_KEYS
  packages/tui/src/components/App.tsx               # string theme state, custom merge, /theme UX
  packages/tui/src/commands/registry.ts             # /theme description + example (THEMES import dropped)
  packages/cli/src/index.tsx                        # boot validates customs, --help unchanged
  README.md                                         # theming rows + custom-themes section
  docs/UI-ROADMAP.md                                # U12/U13 marked done
```

## 4. VERIFICATION

```bash
cd /home/mitravanu/Projects/anvil
npm run build -w @anvil/core
npm run typecheck               # 0 errors, all 3 packages
npm test -w @anvil/core         # 158/158 across 25 files
npm test -w @anvil/tui          # 66/66 across 13 files (was 47/10)
npm run build                   # esbuild bundle OK
git status --porcelain           # only §3 files (+ prior slices' files)
```

Result on 2026-09-05: ALL GREEN.

## 6. U12 FOLLOW-UP — interaction tests (same day)

Stdin simulation proved stable (60ms ticks, zero flakes across runs), so the
two safety-critical `useInput` surfaces got covered after all:

- `components/__tests__/permission.test.tsx` (+4): diff-vs-command
  rendering, Enter→allow-once (no always-grant), second-row→always-allow
  (broker called with tool name), third-row→deny (with bidirectional arrow
  proof). The permission decision matrix — the single most safety-critical
  UI in the app — is now pinned by tests.
- `components/__tests__/input.test.tsx` (+6): echo, trimmed submit+clear,
  empty-submit ignored, menu open/filter/dismiss, Enter-runs-highlighted,
  history Up/Up/Down walk, busy Esc→cancel + busy Enter→never-submit.
  (Idle Ctrl+C→exit deliberately untested — it tears down the app host.)

Still out: pickers + SessionPicker/ModelPicker overlays and FirstRunSetup
(multi-step flows; pure helpers cover their logic). Counts update: TUI
76/76 across 15 files (was 66/13 at §4).

## 7. PROJECT STATE (head-of-project closeout)

Every numbered phase (0–10) and every roadmap item (U1–U13) is built,
tested, and recorded. The remaining known risks live in the records, not in
silence: single-message context overflow (reactive compaction),
project-local destruction behind one Allow (mitigated by /rewind, not
eliminated), MCP servers seeing tool arguments, CJK table widths, style-only
UI regressions (U12 limitation above). Suggested posture from here: use the
thing, fix what bites, commit the stack.
