# Anvil Roadmap — Phases 0, 17–20

> **Status:** PROPOSED (2026-09-08, post-audit) — v0.6.0 hardening tracked in
> `docs/PHASE-16-SPEC.md` ships first. Phase 0 is a new prerequisite for Phase 17.
> **Principle:** Anvil's loop is feature-rich; what it lacks is *measurable quality* and
> *distribution*. These phases close that. Feature sprawl (LSP, agent teams, MCP-server mode)
> is deliberately deferred — see §6.

---

## Phase 0 — Visual Regression Testing for TUI (NEW)

**Prerequisite for Phase 17** — eval harness needs stable, deterministic TUI rendering.
The Phase 15 frame capture scripts (`capture-frames.sh`, `mock-openai-server.mjs`, `ui-preview.tsx`)
are manual-only; no CI gate, no baseline comparison, no cross-size/theme matrix.

- Automated frame capture via `npm run visual:capture` (headless PTY + deterministic mock server)
- 8 scenarios × 6 terminal sizes (80×24, 120×40, 200×60) × 2 themes (dark, highContrast) = 96 baselines
- Pixel-diff via `pixelmatch` (0.1% threshold) with `npm run visual:diff`; CI gate on every PR
- Baseline promotion: `npm run visual:approve` copies current → baseline, stages for commit
- Artifacts uploaded on failure for visual review
- Spec: `docs/PHASE-0-VISUAL-REGRESSION-SPEC.md`

---

## Phase 17 — Verification Harness (agent evals)

The single biggest maturity jump. Today "it works" means unit tests pass; nothing measures
whether the *agent* completes real tasks.

- 15–30 reproducible tasks in a fixture repo: fix a failing test, implement a small feature from
  a spec, migrate a deprecated API, repair a regression.
- Runner builds on the Phase 12 headless mode (`anvil -p`) with `--raw` + exit codes; scoring is
  file/state assertions, not LLM judgment.
- `npm run eval` locally; per-task pass/fail + wall-clock + token spend; stored under
  `ANVIL_HOME/evals/<date>/` for trend comparison.
- Gate: every change to prompts, tools, the goal engine, or compaction runs the harness; a
  regression blocks the release.

## Phase 18 — Provider Certification

The 7 unit-tested-only providers have been open debt since 0.2.0.

- One scripted live pass per provider: streaming, tool calls, multi-turn context, error path
  (deterministic 404), rate-limit handling.
- Result recorded in the model registry (`certified: "live" | "broken" | "untested"`) and
  surfaced in `/model` and the README provider table.
- Re-run script checked into `scripts/` so certification stays current (keys via env, never
  committed).

## Phase 19 — Project Memory & Git-Native Workflow

- Persistent per-project notes (`.anvil/memory.md`, gitignored by default): what was tried,
  where things live, user conventions — injected at session start next to project rules, with a
  size cap like `rules.ts`.
- Auto-commit per goal milestone (opt-in setting; message format
  `anvil(goal): milestone N — <title>`), so a debrief maps to a reviewable history.
- `/diff main` review mode + PR creation via `gh` when available.

## Phase 20 — Distribution

- Real `npm publish` (the root package.json metadata is already publish-ready from 0.3.0 prep).
- CI pipeline: typecheck + tests + eval harness on every push/PR — this alone would have caught
  the audit's typecheck regression.
- Install story beyond `npm i -g`: versioned tags, checksums, README quickstart that matches the
  released binary.

---

## 6. Deliberately deferred (do NOT build next)

- **LSP integration** — large surface, marginal gain while tools + `get_outline` cover the need.
- **Agent teams / swarms** — demo value over daily value; revisit after the harness can score
  multi-agent quality.
- **Anvil as an MCP server** — useful eventually; only worth building once Phases 17–20 land.

Sequencing rule: **0 before 17 before everything else** — Phase 0 locks TUI rendering so the
eval harness (17) measures agent quality, not UI flakiness. Phase 17 then converts later phases
from "we think it works" into "it measurably works", including the Phase 11–15 wave this roadmap builds on.
