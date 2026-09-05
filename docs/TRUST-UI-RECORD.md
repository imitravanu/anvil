# TRUST-UI RECORD — U5 richer diffs + U6 expandable output (2026-09-05)

> Status: IMPLEMENTED + VERIFIED (gates in §4). Single source of truth for
> this slice. Completes the "trust cluster" alongside `/ledger` (U7,
> `docs/HARDENING-RECORD.md` §2.4): the user can now see what the agent wants
> to change (U5), inspect what tools actually returned (U6), and audit what
> ran (U7).

## 0. SCOPE

IN: U5 (line numbers + word-level highlighting, no side-by-side — deferred,
see §3) and U6 (global `/expand` toggle over retained capped output).
OUT: side-by-side diff view, per-tool focus toggle, paged viewer, U8/U9/U10,
Phase 10 MCP. See §5 for sequencing.

## 1. CHANGES (exact file list)

```
NEW (pure engine + tests):
  packages/tui/src/diff/parseDiff.ts              # unified-diff → typed rows
  packages/tui/src/diff/wordDiff.ts               # LCS word-pairing for del/add runs
  packages/tui/src/diff/__tests__/richDiff.test.ts  # +6 tests
  packages/tui/src/util/toolOutput.ts             # formatToolOutput(), MAX_OUTPUT_LINES=30
  packages/tui/src/util/__tests__/toolOutput.test.ts  # +5 tests (incl. retainOutput)
MODIFIED:
  packages/tui/src/diff/colorizeDiff.tsx          # rewritten on the engine (same props)
  packages/tui/src/hooks/useAgentController.ts    # DisplayToolCall.output + retainOutput(6KB)
  packages/tui/src/components/ToolCallView.tsx    # expanded rendering
  packages/tui/src/components/MessageView.tsx     # expandTools prop drill
  packages/tui/src/components/MessageList.tsx     # expandTools prop drill
  packages/tui/src/components/App.tsx             # expandTools state + toggleExpand ctx
  packages/tui/src/commands/types.ts              # +toggleExpand
  packages/tui/src/commands/registry.ts           # +/expand + /help example
  packages/cli/src/index.tsx                      # --help lists /expand
  README.md                                       # /expand row
  docs/UI-ROADMAP.md                              # U5/U6 marked done (partials noted)
```

No core changes. No new runtime dependencies. No key-binding changes.

## 2. DESIGN DETAILS

### 2.1 U5 diff engine
- `parseDiff()` classifies `file` (`---`/`+++`), `hunk` (with parsed
  old/new starts), `add`/`del`/`context` (with running gutters), `meta`
  (markers, pre-hunk text). Trailing-newline artifact stripped; genuinely
  empty hunk lines kept as `context ""` so gutters stay in sync (tested).
- `pairRows()` pairs adjacent del→add runs line-by-line for `diffWords()`
  (LCS on word tokens, whitespace never marked changed); unpaired lines come
  back fully changed. Changed words render inverse+bold in the line color.
- `ColorizedDiff` keeps its props (`{diff}`) — `PermissionPrompt` untouched.
  Rows capped at `MAX_DIFF_ROWS = 40` with an omission note so a huge edit
  can't blow up the permission overlay frame.

### 2.2 U6 expand
- `applyEvent(tool_finished)` now retains `retainOutput(result.output)`,
  capped at `OUTPUT_RETAIN_MAX = 6000` chars JSON with a truncation marker —
  long sessions can't bloat React state (read_file alone can be 512 KiB).
- `formatToolOutput()` leads with `run_command` stdout/stderr (labeled,
  with exit/cap/timeout meta) instead of the JSON envelope; everything else
  pretty-prints. Capped at 30 lines + omission notice.
- `/expand` flips session-scoped `expandTools` state in App (default off,
  never persisted — a resumed session starts compact, same policy as
  always-allow grants). Prop-drilled App→MessageList→MessageView→ToolCallView;
  running calls never expand (live spinner row stays one line).
- Rejected alternative: per-tool focus toggle (numbered `/expand <n>`) —
  needs a focus/numbering system over a window-capped list; global toggle
  satisfies the roadmap's "expand/toggle (or paged view)" at a fraction of
  the complexity. Revisit only with real user demand.

## 3. DELIBERATE PARTIALS (honest, not silent)

- U5 without side-by-side: the roadmap lists it as "optional"; gutter +
  word-highlight covers the trust need. Side-by-side in an 80-col terminal
  is a layout project of its own — do not sneak it into a polish slice.
- U6 without per-tool toggle or pager: see §2.2.

## 4. VERIFICATION

```bash
cd /home/mitravanu/Projects/anvil
npm run build -w @anvil/core
npm run typecheck               # 0 errors, all 3 packages
npm test -w @anvil/core         # 130/130
npm test -w @anvil/tui          # 31/31 (was 20)
npm run build                   # esbuild bundle OK
git status --porcelain           # only §1 files
```

Result on 2026-09-05: ALL GREEN.

## 5. SUGGESTED NEXT SLICES (head-of-project sequencing)

1. **Checkpoint `/rewind`** — the top remaining safety risk (project-local
   destruction behind one Allow). Needs a small spec first: snapshot edited
   files pre-batch, one-key restore, cap snapshot bytes.
2. **U8/U9** (markdown round 2, picker grouping) — close out mid-term UI.
3. **Phase 10 MCP spec** — no spec file exists; use the `AgentOptions.tools`
   seam + `FreeModelSource`-style interface pattern. Spec approval before code.
