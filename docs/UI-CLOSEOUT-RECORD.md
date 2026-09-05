# MID-TERM UI CLOSEOUT — U8 markdown round 2 + U9 picker grouping (2026-09-05)

> Status: IMPLEMENTED + VERIFIED (gates in §4). Single source of truth for
> this slice. With U5–U7 done (`docs/TRUST-UI-RECORD.md`,
> `docs/HARDENING-RECORD.md`), this closes the mid-term UI table except
> long-term items U10–U13 (`docs/UI-ROADMAP.md`).
>
> U8 explicitly lifts part of the Phase 8 C2 non-goals
> (`docs/PRODUCT-POLISH-RECORD.md` §4/C2: links, tables, strikethrough,
> nested lists). That historical record stays immutable — this file is the
> amendment of record: those four are now IN, tested, shipped. Images and
> HTML interpretation stay OUT.

## 1. CHANGES (exact file list)

```
NEW:
  docs/UI-CLOSEOUT-RECORD.md                          # this file
  packages/tui/src/util/grouping.ts                    # groupByProvider (pure)
  packages/tui/src/util/__tests__/grouping.test.ts     # +3 tests
MODIFIED:
  packages/tui/src/markdown/renderMarkdown.ts          # round-2 syntax (pure)
  packages/tui/src/markdown/MarkdownView.tsx           # strike/links/table/depth rendering
  packages/tui/src/markdown/__tests__/renderMarkdown.test.ts  # 1 superseded test replaced + 4 new
  packages/tui/src/components/ModelPicker.tsx          # grouped render + order-following navigation
  docs/UI-ROADMAP.md                                   # U8/U9 marked done
```

No core changes. No new runtime dependencies. No key-binding changes.
No component/interaction test infra (still deferred to U12 — pure tests only).

## 2. DESIGN DETAILS

### 2.1 U8 markdown round 2
- **Links** `[text](url)` → styled text + dim `[n]` marker, URLs collected
  first-seen order, deduped, appended as a `links` footnote block
  (`[n] text → url`). Marker lands on the LAST span of each same-URL run so
  styled multi-span link text marks once. Nested links don't parse (outer
  brackets win, visibly). `![alt](url)` degrades to `!alt [n]` — alt text
  visible, never fetched. Code spans stay literal (fence rule preserved).
- **Nested lists**: `list` blocks gain `depth` (2 spaces = 1 level, tabs
  count double); render indents like quotes do (capped at 4).
- **Tables**: GitHub header+delimiter detection, body rows while lines
  contain `|`; cells inline-parsed (links inside cells footnote normally).
  Render pads to plain-text width (code-point-aware, CJK-safe) with ` | `
  separators — inline styling is dropped inside padded cells (documented in
  code), footnotes still resolve via the links block.
- **Strikethrough** `~~x~~` → dimmed span.
- Superseded test replaced, not deleted: the old "links are literal text"
  test asserted the C2 non-goal this slice lifts; it now asserts the footnote
  behavior. Round-1 shapes preserved (`toEqual` on old span objects still
  passes — new fields are optional).

### 2.2 U9 picker grouping
- Pure `groupByProvider(rows, providerOf, isFreeOf)`: canonical section
  order from `PROVIDER_LABELS` key order (stable across free-list syncs),
  unknown providers trail first-seen; stable free-first partition inside
  each group (registry relative order otherwise kept).
- The picker navigates, selects, and windows over DISPLAY order (flattened
  sections), so highlight and screen can never disagree — the flat-list
  navigation was rewritten, not patched. Section headers
  (`─ Provider · n ─`) are display-only, never selectable; disabled-row
  skipping and the stale-cache notice are unchanged. Rows show the model
  name only (provider moved to the header — fixes the old repetition).

## 3. DELIBERATE PARTIALS

- No side-by-side diff (U5 optional), no per-tool expand, no pager — see
  `docs/TRUST-UI-RECORD.md` §3.
- Table alignment uses code-point width, not East-Asian wide width — CJK
  tables may misalign by a column or two. Accepted: readability preserved,
  no new deps (`string-width` rejected per the no-new-deps rule).
- Images/HTML stay uninterpreted (U8 non-goal, unchanged).

## 4. VERIFICATION

```bash
cd /home/mitravanu/Projects/anvil
npm run build -w @anvil/core
npm run typecheck               # 0 errors, all 3 packages
npm test -w @anvil/core         # 138/138 across 21 files
npm test -w @anvil/tui          # 41/41 across 8 files (was 34/7)
npm run build                   # esbuild bundle OK
git status --porcelain           # only §1 files (+ prior slices' files)
```

Result on 2026-09-05: ALL GREEN.

## 5. REMAINING ROADMAP (nothing mid-term left)

- U10 sub-agent UI (rides with Phase 9 presentation), U11 MCP UX (rides
  with Phase 10), U12 component-test infra, U13 custom themes.
- Suggested next slice: **Phase 10 MCP spec** — no spec file exists yet;
  use the `AgentOptions.tools` seam + `FreeModelSource`-style interface
  pattern. Spec approval before code, per standing rule.
