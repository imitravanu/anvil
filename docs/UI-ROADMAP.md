# UI IMPROVEMENT ROADMAP — Anvil TUI

> Status: **RECOMMENDATION** (proposed by architect, awaiting client approval).
> Nothing here is an approved decision yet. Phase 8's UI workstream (C) is DONE —
> all 12 findings (F1–F12) in PRODUCT-POLISH-RECORD.md are fixed and verified.
> This file organizes what comes NEXT, so no UI idea lives only in someone's head.

## Prioritization principle

Items tied to Phase 9 (sub-agents) or Phase 10 (MCP) are built WITH those phases —
UI follows capability, never precedes it. Standalone items can form a small
optional "Phase 8.5" polish release whenever the client wants a visible jump.

## NEAR-TERM — quick wins (ride along Phase 9, or a Phase 8.5)

| # | Item | Why | Source |
|---|---|---|---|
| U1 | **Persistent plan line** — show the agent's current plan collapsed (≤2 lines) above the input, updating live. Today the plan only appears as one-off system messages. | Completes the original A.1.4 intent; the plan is the agent's promise — it should stay visible | PHASE-8-SPEC A.1.4 |
| U2 | **Streaming caret** — animated indicator at the end of in-flight assistant text (status-bar spinner exists; the text itself has none) | Makes "the model is typing" unmistakable | Phase 8 C4 leftover |
| U3 | **NO_COLOR / terminal capability respect** — honor the standard NO_COLOR env and degrade gracefully on limited terminals | Accessibility + robustness; highContrast theme exists but env signals are ignored | new |
| U4 | **Close the 3 open cosmetic choices** — header glyph (`▲` vs `◆`/inverse), `/theme` in the empty-state suggestions, `/help` examples style. Defaults currently stand | Trivial; clears the record's open questions | PRODUCT-POLISH-RECORD §13 |

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

## Decision needed from client (one line each)

1. Approve this roadmap as the standing UI record? (yes/no/amend)
2. Build U1–U4 as a small **Phase 8.5** before Phase 9, or fold them into Phase 9?
   — Architect recommendation: **fold U1–U2 into Phase 9** (they touch the same
   files as sub-agent UI), do U3–U4 opportunistically. No separate release needed.