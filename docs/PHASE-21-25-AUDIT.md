# PHASE 21–25 ROADMAP — Pre-Execution Audit

> **Purpose:** The roadmap is accurate but decays. This audit re-verified its claims
> against the live tree (2026-09-13, re-audited 2026-09-20) so agents start from current
> reality instead of re-deriving it. Per AGENTS.md §1.3, re-verify the specific item you
> are about to fix before touching code — line numbers below are as of the audit date;
> function names are the durable anchors. This doc is itself a protected artifact: an
> audit outlives roadmaps, so it is re-verified in place rather than abandoned.

## 🔁 Re-audit (2026-09-20)

Every item in the matrix below was re-checked against the live tree by symbol, not by
line number. Net result:

- **The matrix is now all-green.** Every item previously marked 🔴 LIVE is fixed in the
  live tree. Nothing here should be "fixed" again.
- **22.13 remains 🟣 BY-DESIGN and must NOT be changed.**
- Three items previously ⚪ UNVERIFIED were promoted: **22.9, 22.11, 22.17 are all fixed**
  (evidence in the matrix).
- One item is honestly **PARTIAL**: **23.4** — only `MessageView` is memoized; the rest of
  the hot-component list was not audited. Do not read it as done.
- Test counts in the roadmap §8/§21.4 are stale by ~230 tests (see corrections below).
- The "Standing gap" section (this doc, 2026-09-13) was **already closed** by gate Step 1.5
  at the time it was written — the two sections of this doc contradicted each other. Fixed.

**Consequence for the entry protocol:** a new agent following AGENTS.md §1.5 into this doc
must not open work on any matrix item. The remaining work lives in
`docs/STABILIZATION-ROADMAP-2026-09.md`, `PHASE-26`/`PHASE-27` progress docs, and the
forward-looking notes at the end of this file.

## Verified item matrix

Legend: ✅ fixed · 🟡 partial · 🟣 by-design (do NOT fix) · ⚪ unverified.

| Item | Claim | Status | Evidence (re-verified 2026-09-20) |
|---|---|---|---|
| 21.1 | Quote-bypass in `pathsInsideRoot` | ✅ FIXED | `bash.ts` — quotes stripped (`stripShellQuotes`) before resolve and residual quotes rejected post-strip. |
| 21.2 | `isRootWipe` misses `rm -rf /usr` etc. | ✅ FIXED | `bash.ts` — `SYSTEM_PATHS` now covers `/usr`, `/etc`, `/var`, `/dev`, `/boot`; asserted by test. |
| 21.3 | Flag injection via `verify_tests` pattern | ✅ FIXED | `verifyTests.ts` — leading `-` flag / null-byte guards present in `argvWithPattern`. |
| 22.1 | `cancel()` before first `send()` is a no-op | ✅ FIXED | `session.ts` — `pendingCancel` field set/consumed around the first controller creation. |
| 22.2 | Malformed tool-call JSON becomes `{}` | ✅ FIXED | `__parseError` + `rawInput` sentinel carried through `providers/streaming.ts`, `tools/index.ts`, `agent/orchestrator.ts`. |
| 22.3 | Gemini `unknown_tool` on truncated history | ✅ FIXED | `gemini.ts` — orphaned tool results (compacted-away tool_call) are skipped, not sent as `unknown_tool`. |
| 22.4 | Pricing check `=== "0"` is fragile | ✅ FIXED | `freeModels.ts` — numeric comparison; zero string-equality sites remain. |
| 22.5 | Goal verdict regex too strict | ✅ FIXED | `goalEngine.ts` — `/^YES\b/i` accepted, explicit hedge regex rejects `"Yes, but…"`. |
| 22.6 | `read_file` has no binary detection | ✅ FIXED | `readFile.ts` — NUL-byte/binary sniff before returning content. |
| 22.7 | Keyless Ollama blocked by key filter | ✅ FIXED | `config/index.ts` — `KEYLESS_PROVIDERS` exempted from the `apiKey.length > 0` requirement. |
| 22.8 | Vision forwarded to non-vision models | ✅ FIXED | `supportsVision` gate in the message path (image parts omitted for non-vision models). |
| 22.9 | `checkpointStore` wipe-on-read-error | ✅ FIXED (was ⚪) | `loadCheckpoints` logs via `getErrorMessage` and returns `[]` only for a genuinely absent/corrupt file (commented); per-entry validation stops one bad entry discarding the ring. Save path warns too. |
| 22.10 | Sync `readdirSync` in async path | ✅ FIXED | `awareness.ts` — `fs.promises.readdir`; zero `readdirSync` hits. |
| 22.11 | Broker subscribe fires during render | ✅ FIXED (was ⚪) | `usePermissionBroker.ts` — `useEffect(() => broker.subscribe(setPending), [broker])`, unsubscribe returned. Not called during render. |
| 22.12 | `/session rename` misses in-memory title | ✅ FIXED | `commands/handlers/session.ts` — sets `session.title`, so autosave no longer reverts the rename. |
| 22.13 | Empty sync response fails to demote | 🟣 BY-DESIGN — DO NOT FIX | `mergeFreeModels` (`freeModels.ts`) deliberately returns early on `live.length === 0`: "an empty list is a source glitch or network failure, not 'everything became paid'". Demoting on outage would wipe the whole free registry. The roadmap's fix and acceptance criteria contradict this safer design. If demote-on-empty is ever wanted, trigger only on HTTP 200 + empty payload, never on failure/catch paths. |
| 22.15 | Subagent checkpoint orphans on crash | ✅ ALREADY FIXED | `subagent.ts` — cleanup guaranteed AND the sub-ring is handed to the parent (`drainCheckpoints()`) before deleting the persisted file — better than the roadmap's proposed fix (rewind still reaches sub-agent changes). |
| 22.16 | Eval timeout can't break a stalled stream | ✅ ALREADY FIXED | `eval/runner.ts` — timeout calls `session.cancel()` ("aborts the in-flight provider stream, which unwinds the loop promptly"). |
| 22.17 | MCP boot notices dropped in TUI | ✅ FIXED (was ⚪) | `components/App.tsx` mount effect — each `mcp.notices` entry is printed via `printSystemMessage`. |
| 23.2 | Ledger O(n²) copy-append | ✅ FIXED | `session.ts` — appends with a single `ledger.push`; `capLedger` runs only on restore/snapshot, not per event. |
| 23.3 | Compaction O(n²) `isSplit` | ✅ FIXED | `compaction.ts` — `splitCuts` set replaces the per-candidate interval rescan. |
| 23.4 | No `React.memo` on hot components | 🟡 PARTIAL | `components/MessageView.tsx` memoized; the remainder of the hot-component list was **not** audited. Treat as open work. |
| 23.5 | Word-diff LCS bail-out too high | ✅ FIXED | `diff/wordDiff.ts` — bail-out at the `10_000` product threshold; matches spec. |
| 24.4 | `as never` escapes in providers | ✅ FIXED | 0 production `as any` / `as never` hits across core/tui/cli src (was 5 in `gemini.ts`/`openai.ts`). |
| 24.10 | `getErrorMessage` adoption | ✅ FIXED | 0 raw error-format ternaries in production across core/tui/cli src (was 17 in core). Helper + adoption both done. |

## Gate-count corrections (roadmap §8 and §21.4)

- Unit tests: **788, not "494+"** (re-verified 2026-09-20, all green: core 519 / tui 228 /
  cli 41, across 121 test files). The prior figure of 556 (2026-09-13, core 391 / tui 157 /
  cli 8) is superseded; preserving the old number here is the point — counts decay.
- **Correction (self-audit):** an earlier draft of this audit claimed `npm run eval` was
  missing — it is not. `package.json:16` defines `"eval": "npx tsx evals/run.ts"`, so the
  Guardian Gate's Step 5 (`npm run eval -- --fast --mock`) resolves correctly. Likewise
  `certify --mock --all` is confirmed valid: `certify-provider.ts` parses both flags
  (documented in its usage header), and `certify-all.sh` forwards extra args. No gate
  script changes required.

## Standing gap discovered: the gate only scans NEW lines — ✅ RESOLVED

*(Original note, 2026-09-13:)* `scripts/verify-gate.mjs` inspected added diff lines only,
so pre-existing violations survived indefinitely (then: 17 raw error-format sites in core;
`as never` in providers), meaning Phase 24 "purge" items (24.4, 24.10, 24.11) could only be
*done*, never *enforced*, by the gate.

**Resolution (2026-09-13, gate hardening pass #6):** gate **Step 1.5 "Residual Slop Drain
Scan"** now scans the FULL tree (`packages/{core,cli,tui}/**/src`, tests excluded) with
allowlist-free rules for exactly these families — raw error formatting, core self-imports,
empty catches, hardcoded TUI colors — and fails on any hit. Legacy debt can only shrink.
The two purge items above (24.4, 24.10) are now at zero production hits, which is the
mechanism working as designed. The §25.6 fresh-allowlist drain remains the escape valve for
deliberate exemptions (currently empty).

## Unverified-but-plausible remaining

The 2026-09-13 list (22.9, 22.11, 22.17) is now **verified fixed** — see the matrix. Still
open by nature, and each gets the protocol below at execution time:

- 22.14's exact user-visible impact.
- The Phase 24 items not represented in the matrix (24.x residue).
- All Phase 25 features (forward-looking).
- The 8 remaining open boxes in the **Destructive-command filter** family and the rest of
  `docs/STABILIZATION-ROADMAP-2026-09.md` — that is the current live tracker.

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
