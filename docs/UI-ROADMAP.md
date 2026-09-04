# UI IMPROVEMENT ROADMAP — Anvil TUI

> Status: **RECOMMENDATION** (proposed by architect, awaiting client approval).
> Nothing here is an approved decision yet. Phase 8's UI workstream (C) is DONE —
> all 12 findings (F1–F12) in PRODUCT-POLISH-RECORD.md are fixed and verified.
> This file organizes what comes NEXT, so no UI idea lives only in someone's head.

## Prioritization principle

Items tied to Phase 9 (sub-agents) or Phase 10 (MCP) are built WITH those phases —
UI follows capability, never precedes it. Standalone items can form a small
optional "Phase 8.5" polish release whenever the client wants a visible jump.

## NEAR-TERM — ✅ DONE (Phase 8.5, client-approved "yes 8.5")

| # | Item | Status |
|---|---|---|
| U1 | **Persistent plan line** — `PlanLine` above the input, ≤2 width-fitting lines via `collapsePlan()` (pure, tested), live-updates from `plan_updated`, resets on session change/resume/clear | ✅ DONE |
| U2 | **Streaming caret** — the interrupted concurrent session had already implemented this as a braille spinner after streaming text; KEPT as the single implementation (consistent with ToolCallView). Architect's blink-caret variant built, then removed as redundant | ✅ DONE |
| U3 | **NO_COLOR support** — `highlightCodeBlocks` guards its raw-ANSI path (fences stripped, zero escapes, tested); `<Text>` colors already honor NO_COLOR via chalk | ✅ DONE |
| U4 | **Open cosmetic choices closed** — defaults finalized as decisions: keep `▲` glyph; keep 4 empty-state suggestions (no `/theme`); `/help` inline examples (already shipped) | ✅ DONE |

## MID-TERM — visible quality jumps (a "Phase 8.5" candidate)

| # | Item | Why | Source |
|---|---|---|---|
| U5 | **Richer diffs** — line numbers, word-level highlighting, optional side-by-side view in edit/write permission prompts | The diff is the product's trust moment; it deserves the best rendering in the app | ColorizedDiff is line-level only today |
| U6 | **Expandable tool output** — tool results are one line (~60 chars); add an expand/toggle (or paged view) for full output | Users currently cannot inspect what a tool actually returned without leaving the flow | ToolCallView |
| U7 | **Run ledger UI** — `/ledger` command + a per-turn activity summary (what ran, what failed, tokens spent). Phase 8 built the ledger substrate with NO UI by design | The "audit" pillar of the truthful engine is invisible without it | PHASE-8-SPEC A.1.5 |
| U8 | **Markdown round 2** — links (rendered safely as text + footnote), nested lists, tables, strikethrough | Explicitly excluded from C2's bounded renderer; add only with tests | PRODUCT-POLISH-RECORD C2 non-goals |
| U9 | **Model picker grouping** — group by provider with headers instead of one long scrolling list (list keeps free-first ordering inside each group) | 9 providers × many models makes the flat list harder to scan | ModelPicker |

## LONG-TERM — arrives WITH future phases (do not build early)

| # | Item | Phase |
|---|---|---|
| U10 | **Sub-agent UI** — collapsed live progress for delegated tasks, expandable final reports, per-sub-agent token counters | Phase 9 |
| U11 | **MCP tool UX** — permission prompts for unknown external tools (schema + input shown), server health indicators | Phase 10 |
| U12 | **TUI interaction test infra** — ink-testing-library component tests so UI refactors stop being risky (pure-function tests exist since Phase 8; component tests were deliberately deferred) | Post-9/10 reliability phase |
| U13 | **Custom user themes** — user-defined theme file in ~/.anvil | low priority |

## Decision needed from client (RESOLVED)

1. Roadmap approved as the standing UI record: **YES** (client, "yes 8.5").
2. Client chose: **ship U1–U4 as Phase 8.5** (done). Architect's fold-into-9
   recommendation was superseded by the client's explicit choice.