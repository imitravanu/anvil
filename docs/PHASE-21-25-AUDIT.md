# PHASE 21–25 ROADMAP — Pre-Execution Audit

> **Purpose:** The roadmap is accurate but decays. This audit re-verified its claims
> against the live tree (2026-09-13) so agents start from current reality instead of
> re-deriving it. Per AGENTS.md §1.3, re-verify the specific item you are about to fix
> before touching code — line numbers below are as of the audit date; function names
> are the durable anchors.

## Verified item matrix

| Item | Claim | Status | Evidence (as of audit) |
|---|---|---|---|
| 21.1 | Quote-bypass in `pathsInsideRoot` | 🔴 LIVE | `bash.ts` — no quote stripping before resolve; `cat "/etc/passwd"` passes containment |
| 21.2 | `isRootWipe` misses `rm -rf /usr` etc. | 🔴 LIVE | final regex matches only `/`, `/*`, `~`, `$HOME`. **Severity note:** exposure is in auto-approve / `-y` / headless paths; interactive mode still prompts. |
| 21.3 | Flag injection via `verify_tests` pattern | 🔴 LIVE | `argvWithPattern` has no `startsWith("-")` / null-byte guard |
| 22.1 | `cancel()` before first `send()` is a no-op | 🔴 LIVE | `session.ts` `cancel()` is plain `this.currentController?.abort()`; no `pendingCancel` field |
| 22.2 | Malformed tool-call JSON becomes `{}` | 🔴 LIVE | `session.ts:514-516` `catch { input = {}; }` — model never learns its JSON was bad |
| 22.3 | Gemini `unknown_tool` on truncated history | 🔴 LIVE | `gemini.ts:149` `callNames.get(...) ?? "unknown_tool"` |
| 22.4 | Pricing check `=== "0"` is fragile | 🔴 LIVE | `freeModels.ts:58` string comparison |
| 22.5 | Goal verdict regex too strict | 🔴 LIVE | `goalEngine.ts:271-272` rejects `"YES."`, `"YES, ..."` |
| 22.6 | `read_file` has no binary detection | 🔴 LIVE | no binary/NUL sniff in `readFile.ts` |
| 22.7 | Keyless Ollama blocked by key filter | 🔴 LIVE | `config/index.ts:128-132` requires `apiKey.length > 0` for ALL providers |
| 22.8 | Vision forwarded to non-vision models | 🔴 LIVE | `supportsVision` exists on the type only; no gate in the message path |
| 22.10 | Sync `readdirSync` in async path | 🔴 LIVE | `awareness.ts:128` |
| 22.11 | Broker subscribe fires during render | ⚪ UNVERIFIED | `TuiPermissionBroker.subscribe()` does call the listener synchronously; React impact not independently confirmed |
| 22.12 | `/session rename` misses in-memory title | 🔴 LIVE | `commands/registry.ts:317-324` never sets `session.title` — next autosave reverts the rename |
| 22.13 | Empty sync response fails to demote | 🟣 BY-DESIGN — DO NOT FIX | `mergeFreeModels` (`freeModels.ts:444-448`) deliberately returns early on `live.length === 0`: "an empty list is a source glitch or network failure, not 'everything became paid'". Demoting on outage would wipe the whole free registry. The roadmap's fix and acceptance criteria contradict this safer design. If demote-on-empty is ever wanted, trigger only on HTTP 200 + empty payload, never on failure/catch paths. |
| 22.15 | Subagent checkpoint orphans on crash | ✅ ALREADY FIXED | `subagent.ts` — cleanup guaranteed AND the sub-ring is handed to the parent (`drainCheckpoints()`) before deleting the persisted file — better than the roadmap's proposed fix (rewind still reaches sub-agent changes). Remove from backlog. |
| 22.16 | Eval timeout can't break a stalled stream | ✅ ALREADY FIXED | `eval/runner.ts:119-126` — timeout calls `session.cancel()` ("aborts the in-flight provider stream, which unwinds the loop promptly"). Remove from backlog. |
| 22.17 | MCP boot notices dropped in TUI | ⚪ UNVERIFIED | notice plumbing exists (`util/mcp.ts`); the drop point was not traced during this audit |
| 23.2 | Ledger O(n²) copy-append | 🔴 LIVE | `session.ts:307` `capLedger([...this.ledger, {...}])` per event — O(n) copy per append inside a turn |
| 23.3 | Compaction O(n²) `isSplit` | 🔴 LIVE | `compaction.ts:83-99` — `intervals.some` re-scanned for every candidate cut |
| 23.4 | No `React.memo` on hot components | 🔴 LIVE | zero `memo(` hits in `tui/src/components/` |
| 23.5 | Word-diff LCS bail-out too high | 🔴 LIVE | bail-out exists (`wordDiff.ts:41`); threshold value not yet compared with the spec — confirm at execution |
| 24.4 | `as never` escapes in providers | 🔴 LIVE | 5 hits: `gemini.ts:194,206,212`, `openai.ts:231,232,236` |
| 24.10 | `getErrorMessage` adoption | 🔴 LIVE (rescoped) | helper already exists (`errors.ts:19`) with **zero production callers**; 17 raw `err instanceof Error ? err.message : String(err)` sites in core. The work is adoption, not authorship. |


## Gate-count corrections (roadmap §8 and §21.4)

- Unit tests: **556, not "494+"** (verified 2026-09-13, all green: core 391 / tui 157 / cli 8).
- **Correction (self-audit):** an earlier draft of this audit claimed `npm run eval` was
  missing — it is not. `package.json:16` defines `"eval": "npx tsx evals/run.ts"`, so the
  Guardian Gate's Step 5 (`npm run eval -- --fast --mock`) resolves correctly. Likewise
  `certify --mock --all` is confirmed valid: `certify-provider.ts` parses both flags
  (documented in its usage header), and `certify-all.sh` forwards extra args. No gate
  script changes required.

## Standing gap discovered: the gate only scans NEW lines

`scripts/verify-gate.mjs` inspects added diff lines, so pre-existing violations survive
indefinitely (today: 17 raw error-format sites in core; `as never` in providers). That is
a sensible design for incremental work, but it means Phase 24 "purge" items (24.4, 24.10,
24.11) can only be *done*, never *enforced*, by the gate. Recommendation: when executing
24.4/24.10, convert whole files in the same commit and record them in a small
"clean-file list" the gate may extend to full-file scanning later — the §25.6
fresh-allowlist "drain" concept is the right long-term mechanism.

## Unverified-but-plausible remaining

22.9 (checkpointStore wipe-on-read-error — the `catch { return []; }` at
`checkpointStore.ts:103` matches the claimed behavior, but the "wipes history" flow was
not traced end-to-end), 22.14's exact user-visible impact, remaining 24.x items, and all
Phase 25 features (forward-looking by nature). Each gets the protocol below at execution
time.

## Reality Check Protocol (every roadmap item, before fixing)

1. Open the file at the roadmap's location; if the quoted "broken" snippet is absent,
   search for the function/symbol name — the item may be fixed or drifted already.
2. Classify: 🔴 live → fix now · ✅ fixed → skip and note · 🟣 by-design → do NOT fix,
   record the design rationale in the progress doc · ⚪ can't confirm → trace before code.
3. Write the failing test FIRST for 🔴 items (standing rule 7.8), then fix, then gate.
4. Record the item's final status in `PHASE-NN-PROGRESS.md` with evidence line numbers.

## Gate hardening (2026-09-13) — protecting the gate from the agents it polices

### Attack surface
The gate, allowlist, AGENTS.md, and CI workflows are all repo files. Any agent with repo
write access can edit them. The gate is only as strong as the weakest thing that lets a
change slide through silently.

### Vulnerabilities found & closed in this pass
1. **Silent-skip on scan error** — if the diff command failed, Step 1 printed "scan
   skipped" and PASSED. Any git anomaly would have quietly disabled the scanner.
   → Now `fail()`s. A scan that cannot run is a failure, not a skip.
2. **Weaponizable allowlist** — the filter was `violations.filter(v => !entries.some(e => v.includes(e.file)))`.
   A single entry `"packages"` would have suppressed every violation; a malformed
   allowlist was silently ignored. → Entries must match `packages/<pkg>/src/*`, require a
   real reason, and an unparseable allowlist now fails the gate.
3. **Untracked-file blind spot** — `git diff` never shows untracked files, so a brand-new
   slop file shipped unscanned on its first commit and became permanent legacy debt.
   → Step 1 now scans `git ls-files --others --exclude-standard` sources as synthetic
   added lines.
4. **CI-invisible diffs** — `git diff HEAD` is empty in a clean checkout, so Step 1 was a
   no-op in CI. → CI mode diffs against `origin/<GITHUB_BASE_REF>...HEAD` on PRs and
   `HEAD~1` on push (requires `fetch-depth: 0`, added to ci.yml).
5. **No gate in CI** — ci.yml ran the components separately, so a weakened local gate had
   no CI checkpoint. → ci.yml now ends with `npm run gate`.
6. **Regenerating legacy slop (the "debt that never dies" bug)** — the diff scanner only
   sees ADDED lines, so raw error formatting, core self-imports, empty catches, and
   hardcoded TUI colors already committed stayed invisible forever — and every agent
   patching nearby copied the pattern again (the live OpenCode session did exactly this,
   re-adding two raw-error sites after the drain pass ran). → New **Step 1.5 "Residual
   Slop Drain Scan"** scans the FULL tree (packages/{core,cli,tui}/**/*.{ts,tsx},
   excluding tests/dist) with allowlist-free rules for exactly these families and fails
   the gate on any hit. Legacy debt can now only shrink: migrate once → green forever.
   (First run of the scan caught the two agent-introduced sites, proving the design.)
7. **Commit-time blind spot** — nothing enforced anything at `git commit`; an agent could
   stage and commit a weakened gate locally and only discover the refusal at CI time (or
   never, on a repo without CI). → A **versioned pre-commit hook** (`.githooks/pre-commit`,
   itself protected + hashed + sentinel-guarded) runs the new `--quick --staged` gate mode
   (Steps 0–1.5: manifest integrity, tamper refusal, slop scan, residual drain) and refuses
   the commit. Install per clone with `npm run hooks:install`. The hook cannot smuggle the
   ack flag (sentinel asserts its absence). The only bypass left is `git commit
   --no-verify` — a deliberate, visible act that still faces CI's full gate and human PR
   review at merge time.

### Layered defenses (no single layer is trusted alone)
- **Step 0.5 integrity manifest** (`scripts/gate-manifest.json`): SHA-256 of the gate,
  manifest, AGENTS.md, allowlist, audit doc, sentinel test, and all four workflow files.
  Any drift fails the gate until the manifest is deliberately regenerated in the same
  commit with human review.
- **Sentinel test OUTSIDE the gate** (`packages/cli/src/__tests__/gate.sentinel.test.ts`):
  runs in the normal vitest suite (enforced by CI's `npm test` independently of the gate
  script). Asserts the gate still contains every rule regex, `fail()`/`process.exit(1)`
  wiring, all step scaffolds, the untracked/CI-aware scanning, allowlist validation, and
  that the manifest matches live content. Gutting the gate without also gutting and
  re-manifesting this test fails CI.
- **Protected-path tamper detection**: Step 1 prints a loud warning on any change to
  protected paths and locally REFUSES to pass without `--ack-protected-change`. In CI,
  pull-request review is the acknowledgement layer.
- **Commit-time enforcement** (`.githooks/pre-commit`, versioned): every commit in an
  installed clone runs the quick gate (`--staged --quick` = Steps 0–1.5) and REFUSES
  commits that tamper with protected artifacts (or add slop). The hook delegates ALL
  logic to the gate — no duplicate rules to drift — and cannot smuggle the ack flag
  (sentinel-asserted). Human escape hatch: `git commit --no-verify` (deliberate, loud),
  which still faces CI's full gate and human PR review at merge time.
- **Constitution rule 4** (AGENTS.md): protected artifacts require progress-doc
  declaration + same-commit manifest/sentinel update + human review.

### Honest limit (read this before trusting the gate)
A same-repo checker cannot fully defend against a same-repo attacker. An agent that
edits the sentinel test, the manifest, the constitution, AND the workflows **together**
cannot be stopped by mechanics inside the repo — only by:
- **human review of the protected-path diff** (the changes are always visible in git
  history), and
- **out-of-repo trust anchors** (recommended follow-ups):
  1. GitHub branch protection on `master`: required PR + review for `.github/`,
     `scripts/`, `AGENTS.md`, `docs/`.
  2. A pre-push hook or signed-commit policy from a human-held key.
  3. Locally, `chattr +i` on `scripts/verify-gate.mjs` / `scripts/gate-manifest.json`
     for a development box (breaks the ceremony; optional).

What this pass guarantees: accidental or lazy tampering fails fast and loudly; every
tamper is a visible, attributable commit; honest agents are kept honest by mechanics
that do not depend on the gate's own goodwill.

## Recommended scope adjustment (Phase 23)

Items 23.8–23.15 (alternate screen, mouse protocol, desktop notifications, OSC-52
clipboard, truecolor tokenizer, multi-pane navigation) are **features**, not stability
work. Executing them inside "Phase 23 — Stability & Performance" breaks the roadmap's
own doctrine ("stability before features"). Recommendation: ship 23.1–23.7 as Phase 23
proper; move 23.8–23.15 to a distinct phase (e.g. "Phase 23b — Terminal Platform" or
under Phase 25). The roadmap keeps the sections in place for reference; this audit is
the scope ruling until the roadmap text is amended.

