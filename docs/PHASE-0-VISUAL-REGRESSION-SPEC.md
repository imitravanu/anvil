# PHASE 0 SPEC — Visual Regression Testing for TUI

> **Status:** DONE (2026-09-10) — implemented superset: 96-PNG matrix (8 scenarios × 6 sizes × 2 themes) + 11 text-frame baselines, capture/diff/approve scripts, `visual-regression.yml` CI gate, 0.1% threshold. Note: ships text frames + PNG capture instead of the spec's node-pty/puppeteer plan.
> **Scope:** Automated TUI frame capture + pixel-diff CI gate

---

## 1. Problem

- Phase 15 added `capture-frames.sh` + `mock-openai-server.mjs` + `ui-preview.tsx` for **manual** frame capture during live verification
- No automated baseline comparison, no CI gate, no cross-terminal rendering matrix
- Visual regressions (line stacking, header collapse, markdown rendering) caught only by human inspection

---

## 2. Acceptance Criteria

| ID | Requirement | Verification |
|----|-------------|--------------|
| VR1 | `npm run visual:capture` produces deterministic PNG frames for 6+ scenarios | Frame count + SHA256 stability across runs |
| VR2 | `npm run visual:diff` compares current frames against committed baselines | Exit code 0 = no diff; non-zero = pixel diff > threshold |
| VR3 | CI runs visual diff on every PR; fails on regression | GitHub Actions workflow green on main, red on known-breaking change |
| VR4 | Baseline update workflow: `npm run visual:approve` promotes current to baseline | Single-command baseline bump; committed frames update |
| VR5 | Matrix: 3 terminal sizes (80×24, 120×40, 200×60) × 2 themes (dark, highContrast) | 6 baseline frames per scenario |

---

## 3. Scenarios to Capture (extendable)

1. **Empty state** — boot, no messages
2. **Chat exchange** — user + assistant text + tool call + result
3. **Markdown rendering** — code blocks, tables, ordered lists, nested blocks
4. **Permission prompt** — diff modal open
5. **MissionDeck** — active goal with 3 milestones (pending/running/completed)
6. **Header <80-col collapse** — long model name truncation
7. **VerificationCard** — failing test + auto-repair badge
8. **RewindModal** — timeline with 5 checkpoints

---

## 4. Implementation Plan

### 4.1 Infrastructure (new files)

```
packages/tui/
├── scripts/
│   ├── visual-capture.mjs      # headless frame capture (replaces capture-frames.sh)
│   ├── visual-diff.mjs         # pixelmatch comparison + threshold
│   └── visual-approve.mjs      # promote current → baseline
├── __visual-baselines__/       # committed PNG baselines (git-tracked)
│   ├── dark-80x24/
│   ├── dark-120x40/
│   ├── dark-200x60/
│   ├── highContrast-80x24/
│   ├── highContrast-120x40/
│   └── highContrast-200x60/
└── vitest.visual.config.ts     # vitest config for visual tests
```

### 4.2 Capture Engine (`visual-capture.mjs`)

- Spawns `anvil` headless with `mock-openai-server.mjs` (deterministic responses)
- Uses `pty.js` or `node-pty` to allocate real PTY (Ink needs it for layout)
- Renders each scenario via scripted input sequence
- Captures frame via `stdout` ANSI → `ansi-to-html` → `puppeteer` screenshot
- **Determinism**: fixed `Date.now()` mock, fixed spinner frame, no timers

### 4.3 Diff Engine (`visual-diff.mjs`)

- Uses `pixelmatch` (same as Storybook/Chromatic)
- Threshold: **0.1% pixel diff** (configurable per scenario via JSON sidecar)
- Output: diff PNG + JSON report (`{ scenario, size, theme, diffPixels, percent, passed }`)
- Exit code: 0 = all pass, 1 = any fail

### 4.4 CI Integration (`.github/workflows/visual-regression.yml`)

```yaml
on: [push, pull_request]
jobs:
  visual-regression:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci
      - run: npm run build
      - run: npm run visual:capture
      - run: npm run visual:diff
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: visual-diffs
          path: packages/tui/__visual-diffs__/
```

### 4.5 Baseline Management

- Baselines committed to `__visual-baselines__/` (PNG, ~50KB each × 6 sizes × 8 scenarios × 2 themes = ~48 files)
- `npm run visual:approve` copies `__visual-current__/` → `__visual-baselines__/` and stages them
- PR reviewers see diff artifact on failure; approve → maintainer runs `visual:approve`

---

## 5. Dependencies (add to `@anvil/tui` devDependencies)

```json
{
  "pixelmatch": "^5.3.0",
  "pngjs": "^7.0.0",
  "ansi-to-html": "^0.7.2",
  "puppeteer-core": "^22.0.0",
  "node-pty": "^1.0.0"
}
```

---

## 6. Non-Goals

- Cross-OS rendering (Windows ConPTY vs Linux PTY) — start with Ubuntu CI only
- Video/GIF capture — static frames sufficient for regression
- Font rendering differences — baseline captured on CI runner font

---

## 7. Sequence

1. **Phase 0.1** — Capture engine + 3 core scenarios (empty, chat, markdown)
2. **Phase 0.2** — Diff engine + threshold tuning + CI workflow
3. **Phase 0.3** — Remaining 5 scenarios + matrix (6 sizes × 2 themes)
4. **Phase 0.4** — Baseline approval workflow + docs

---

## 8. Why Before Phase 17

Phase 17 (eval harness) needs **reliable TUI rendering** as a prerequisite — if the cockpit UI corrupts (line stacking, header collapse), eval tasks that verify UI state become flaky. Visual regression catches exactly the bugs the Phase 16 audit fixed (and future regressions of same class).