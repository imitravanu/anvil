# Anvil Roadmap — Phases 17–20

> **Status:** PROPOSED (2026-09-06, post-audit) — v0.6.0 hardening is tracked separately in
> `docs/PHASE-16-SPEC.md` and ships first.
> **Principle:** Anvil's loop is feature-rich; what it lacks is *measurable quality* and
> *distribution*. These phases close that. Feature sprawl (LSP, agent teams, MCP-server mode)
> is deliberately deferred — see §5.

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

## 5. Deliberately deferred (do NOT build next)

- **LSP integration** — large surface, marginal gain while tools + `get_outline` cover the need.
- **Agent teams / swarms** — demo value over daily value; revisit after the harness can score
  multi-agent quality.
- **Anvil as an MCP server** — useful eventually; only worth building once Phases 17–20 land.

Sequencing rule: 17 before everything else — it converts later phases from "we think it works"
into "it measurably works", including the Phase 11–15 wave this roadmap builds on.
