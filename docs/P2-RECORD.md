# P2 RECORD — slop paydown + small correctness (2026-09-05)

> Status: IMPLEMENTED + VERIFIED (gates in §4). Covers the mechanical half
> of `docs/CODE-REVIEW-RECORD.md` §3 plus small §1/§2 tail items. Deliberate
> deferrals (with reasons) in §3.

## 1. WHAT CHANGED

**Shared UI substrate** (`util/displayLimits.ts`, `components/ExpandedLines.tsx`,
`hooks/useWindowedList.ts`, `util/providers.ts`):
- One home for budgets (60/40/30/15/8/1000/100) + shared `capLines`/
  `omittedLine`/`ExpandedLines` (ToolCallView + SubAgentView render through it).
- `pricingKind` decision + `formatPricingTag` string adopted in App, Header,
  StatusBar, ModelPicker (decision and rendering no longer duplicable).
- `useWindowedList` (pure `windowOffset` core, tested) adopted by both
  pickers; `PROVIDER_META` single table (short + marketing labels +
  credential fields) consumed by FirstRunSetup.
- `MessageView` streaming/settled branches deduped (cards render once);
  sub-agent keys are append-stable positions; U2 comment essay trimmed.

**Core consolidation:**
- `anvilHome()` lives once in `atomicWrite.ts` (leaf); config/cache/store/
  mcp import it (the HARDENING record's "unification" claim is now true).
- `write_file` preserves mode bits (scripts stay executable) + capped
  describe preview; `edit_file` validates uniqueness BEFORE diffing (preview
  can no longer show a doomed first-match diff) + oversized test.
- `switchModel`/`clearHistory` reset token bookkeeping; `getHistory`/
  `getRunLedger` return copies; `/rewind` id strictly decimal.
- `UnknownProviderError` distinguishes typos from missing keys (old test
  updated — it enshrined the misleading message); model ids stay free-form
  on purpose (OpenRouter-style providers accept arbitrary ids).
- `retainOutput` caps during serialization (replacer-first) and always
  returns bounded state; tests updated to the consistent contract.

**Theme behavior:** `/theme` re-reads customs on every invocation (no
restart needed); highContrast `dim` fixed to gray; color-key count covered
by a self-maintaining test (also corrects the "12 keys" comment — there are
11).

**Spec amendments** (history preserved, marked inline): Phase-8
`getFreeModels`→`fetchFreeModels`; REWIND `takeSnapshot` id param +
metadata-only `getCheckpoints`; Phase-10 `misconfigured` (kept in code as a
handled variant, documented as never-emitted) + 3-arg executor.

## 2. TESTS

+9: pricing/windowing (3), writeFile mode (1), editFile describe-refusal (1),
unknown-provider split (1, replacing the old assertion), theme key coverage
(1), provider-id validation (in split test), MessageView keys (covered by
existing chrome tests). Retain contract test rewritten for the consistent
behavior.

## 3. DEFERRED WITH REASONS (not forgotten)

- Registry real context windows: inventing values is worse than placeholders;
  needs per-model research, not a code pass.
- `EACCES`-vs-`ENOENT` reader split: would break the codebase-wide
  never-throw-reader policy; changing one reader alone is inconsistent.
- App frame off-by-2 / `useTerminalWidth`: needs visual verification, not
  blind arithmetic.
- Full `CollapsibleCard` merge: shells differ enough that `ExpandedLines` +
  shared caps capture the duplication without forcing uniformity.
- `eventType` union, `session/types` import move, one-use-helper inlining:
  churn without behavioral gain; parked.
- `misconfigured` variant kept (handled, never emitted) rather than deleted.

## 4. VERIFICATION

```bash
npm run build -w @anvil/core && npm run build -w @anvil/tui
npm run typecheck               # 0 errors, all 3 packages
npm test -w @anvil/core         # 205/205 across 29 files
npm test -w @anvil/tui          # 85/85 across 17 files
npm run build                   # esbuild bundle OK
```

Result: ALL GREEN. Catches during the slice (fixed before green): duplicated
`LEDGER_MAX_ROWS` const, wrong `displayLimits` import depth in the hook,
dropped oversize-test header repaired, `setCustomThemes` setter wiring,
`retainOutput` contract made consistent (clone, not identity).
