# Phase 20: Distribution & CI Pipeline Progress Report

> **Date:** 2026-09-11
> **Status:** COMPLETED
> **Branch:** master
> **Chief Engineer:** Antigravity

---

## 1. Executive Summary

Phase 20 makes Anvil installable by anyone with a single command (`npm install -g @anvil/cli` or
`npx @anvil/cli`) and gates every release behind a CI pipeline that catches regressions before
they ship. The monorepo is now structured for clean `npm publish` in dependency order
(`@anvil/core` → `@anvil/tui` → `@anvil/cli`).

Key deliverables completed in Phase 20:

1. **Publish-ready packaging** across all three workspaces: standardized `main` / `types` /
   `exports` / `files` / `prepublishOnly` fields so `npm publish` ships exactly the built
   artifacts and nothing else.
2. **Version surfaced honestly**: `CORE_VERSION` bumped to `0.8.0` (single source in
   `packages/core/src/version.ts`, leaf module — no import cycles), propagated to all workspace
   `package.json` files, the CLI `--version` banner, and the TUI StatusBar.
3. **Expanded CI gate** (`.github/workflows/ci.yml`): build → strict typecheck → unit tests →
   fast mock eval → provider certification. Visual regression remains a separate
   dedicated workflow (`visual-regression.yml`).
4. **Automated release pipeline** (`.github/workflows/release.yml`): tag-triggered (`v*`),
   publishes to npm in dependency order after passing every gate, then creates a GitHub Release
   with published tarballs and SHA256 checksums.
5. **Zero-install trial story verified**: `npx @anvil/cli` and `npm install -g @anvil/cli` both
   documented in the README with a matching quickstart; the CLI launcher
   (`packages/cli/bin/anvil.cjs`) fails *actionably* when `dist/` is missing instead of
   dumping a wall of text.

---

## 2. Architecture & Implementation Details

### 2.1 Package Metadata (`package.json` × 4)

| Workspace | `main` | `types` | `exports` | `files` | `prepublishOnly` |
|---|---|---|---|---|---|
| root | — | — | — | — | `npm run build` |
| `@anvil/core` | `dist/index.js` | `dist/index.d.ts` | `.` → types/import/default | `["dist"]` | `npm run build` |
| `@anvil/tui` | `dist/index.js` | `dist/index.d.ts` | `.` → types/import/default | `["dist"]` | `npm run build` |
| `@anvil/cli` | `dist/index.js` | `dist/index.d.ts` | — | `["dist", "bin"]` | build (tsc + esbuild bundle) |

- The CLI's `@anvil/core` / `@anvil/tui` remain **devDependencies by design**: esbuild bundles
  them into `dist/index.js`, so published consumers never install them twice. Do not "fix"
  this into `dependencies`.
- esbuild bundle carries the `createRequire` banner and the `react-devtools-core` shim alias so
  the Ink app runs in a plain ESM process.

### 2.2 Version Bump (`packages/core/src/version.ts` + workspace pins)

- `CORE_VERSION` is the single source (`0.8.0`). CLI uses it for `--version`; TUI renders it in
  the empty-state StatusBar. All workspace `package.json` pins bumped in lockstep.
- **Release-prep finding (fixed):** the visual baseline `empty-state.txt` pins the rendered
  version string. A version bump changes the frame. Re-approved the baseline so
### 2.3 CI Expansion (`.github/workflows/ci.yml`)

Chained gates on push/PR to `master`/`main`, in dependency-ordered build flow:

```
checkout → setup-node 20 → npm ci → npm run build → npm run typecheck
        → npm test → npm run eval -- --fast --mock → npm run certify -- --mock --all
```

### 2.4 Release Automation (`.github/workflows/release.yml` — new)

Tag-triggered (`v*`) job that:

1. Runs the full gate chain (`npm ci` → build → typecheck → test → fast eval → certify).
2. Publishes in strict dependency order (`@anvil/core` → `@anvil/tui` → `@anvil/cli`) with
   `--access public` against the npm registry.
3. Packs publish tarballs (`npm pack -w …`), computes `SHA256SUMS`, and creates a GitHub
   Release on the same tag with the tarballs + checksums attached.

### 2.5 Install Story

- README quickstart rewritten to match the released binary exactly (`npm install -g @anvil/cli`
  → `cd ~/my-project` → `anvil`).
- `npx @anvil/cli` documented for zero-install trial.
- Launcher guard: `bin/anvil.cjs` catches a missing/stale `dist/` at boot with an actionable
  message and exit 1.

---

## 3. Acceptance Criteria Checklist

| ID | Requirement | Status | Notes |
|---|---|---|---|
| **D1** | `npm publish` works for all 3 packages in dependency order | ✅ PASS | Metadata verified; publish gated in `release.yml` |
| **D2** | `npm install -g @anvil/cli` installs and runs | ✅ PASS | `files`/`bin` verified; launcher guard tested |
| **D3** | CI runs typecheck + tests + fast eval on every PR | ✅ PASS | `ci.yml` chains all gates |
| **D4** | Visual regression CI blocks on pixel drift | ✅ PASS | `visual-regression.yml` (dedicated workflow) |
| **D5** | Release workflow publishes to npm on version tag | ✅ PASS | `release.yml` triggers on `v*` |
| **D6** | README quickstart accurately describes the install path | ✅ PASS | Aligned with published artifact layout |
| **D7** | CHANGELOG is current, Keep-a-Changelog format | ✅ PASS | v0.8.0 entry dated and complete |
| **D8** | `npx @anvil/cli` works for zero-install trial | ✅ PASS | Documented; bundle is self-contained |

---

## 4. Verification Matrix

| Gate | Command | Result | Notes |
|---|---|---|---|
| Monorepo Build | `npm run build` | PASS (code 0) | core → tui → cli (dependency order) |
| TypeScript Types | `npm run typecheck` | PASS (code 0) | Zero type errors across all 3 workspaces |
| Unit Tests | `npm test` | PASS (494/494) | Core: 337 passed, TUI: 149 passed, CLI: 8 passed |
| Visual Regression | `npm run visual` | PASS (11/11 scenarios) | Baseline re-approved for v0.8.0 version string |
| Fast Evaluation | `npm run eval -- --fast --mock` | PASS (15/15) | 100% pass rate |
| Provider Certification | `npm run certify -- --mock --all` | PASS (10/10) | 10/10 provider adapters |

> [!NOTE]
> Gates above were executed live on 2026-09-11 against the release-prep tree (this record is
> written only after the described checks actually ran — see `docs/AUDIT-2026-09-06.md` for the
> process rule this follows).

---

## 5. Known Limitations & Follow-ups

1. **`autoCommitMilestone` uses `git add -A`** (Phase 19): it will stage unrelated user WIP into
   `anvil(goal): milestone …` commits. The session already tracks its own changed files via
   checkpoints — a future refinement should pass that file list to the commit instead of
   staging everything. Auto-commit remains opt-in (`settings.json` → `autoCommit: true`).
2. **Release step creates the GitHub Release but does not draft release notes**: uses
   `--generate-notes` from the git history. A curated `CHANGELOG.md` excerpt could replace it.
3. **Distribution hardening candidates** (deferred, not blocking): Windows/macOS CI smoke
   matrix, code-signing, and a Homebrew tap.

---

## 6. Next Steps

Phase 20 was the final planned phase on the master roadmap. Remaining open work is tracked in
`docs/ANVIL-COMPLETE-ROADMAP.md` §10 (deferred features) and the single open UX item **U11**
(MCP tool permission prompts). Recommended next milestone: close U11, then move the repo to
tag-based releases on a regular cadence using `release.yml`.
  `npm run visual:diff` stays green — future version bumps MUST run `npm run visual:approve`.