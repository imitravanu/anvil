# Phase 37 — Workspace Walk Hygiene

> **Version:** v1.10.0 → v1.11.0
> **Date:** 2026-09-28
> **Author:** Chief Engineer
> **Core Mandate:** *"We are not making some cheap copy here; we are building frontier coding tools."*
> **Status:** COMPLETE (2026-09-28) — the exclusion set gained the Rust/Go/Python
> entries with a fail-first test and a mutation receipt; the collision boundary
> and the live baseline are recorded; gate Steps 0–5 green (1,282 tests, 25/25 evals).
> **Scope:** Opened from the Phase 36 §4 trigger (a built Rust repo) plus two
> new probe receipts: the full live lane measured and one boundary demonstrated.

---

## 1. Receipts before scope

**Probe D — walk hygiene (exclusion gap):**

- Fixture with a non-excluded Rust build tree (`target/debug/deps/`, 200 generated
  files): current code indexed **402 symbols** and resolved `gen_fn_7`; excluding
  `target` leaves **2 symbols** and the generated name resolves to nothing.
- Real-world anchor: this machine's `noteflow/src-tauri/target` holds
  **17,997 files / 15 GB**; it is skipped today only by luck — its generated `.rs`
  files sit under `target/debug/build/`, and `build` is already excluded.
  `target/debug/deps`, `vendor/` (Go), and `.venv/` (Python) are the same class
  and are **not** covered.
- One shared set (`tools/paths.ts`) feeds every walk: symbol index (build and
  freshness discovery), grep, list_files, get_outline, goal awareness.

**Probe E — full live lane, `inception/mercury-2.5` (first full-suite live run):**

- **24/25 (96%)**, 259 s wall clock, 4,69,001 in / 25,621 out tokens, **$0.00**.
- The single failure is task 16 (`feature-ts-generics`): the model broke
  `tsconfig.json` (`error TS5095: Option 'bundler' can only be used ...`) after
  18 tool calls — a genuine model failure, cleanly graded.
- Strategic reading: the suite is now nearly saturated for this model class —
  measuring a frontier gap needs harder tasks, recorded in §4.

**Probe F — parallel team write collision (demonstrated, not fixed):**

- Two sessions (the parallel-team topology: independent histories, shared
  filesystem) each wrote `shared.txt` with different content in the same turn:
  both reported `write_file=ok`, final content held **only one** of them —
  silent loss, no error anywhere to notice.
- This is inherent to concurrent whole-file writes without optimistic
  concurrency; the fix is a design decision (see §4), not a patch.

## 2. Wave sequence

| Task | Focus Area | Impact | Priority | Status |
| :--- | :--- | :--- | :---: | :---: |
| **37.1** | Exclude build output and dependency trees (`target`, `vendor`, `__pycache__`, `.venv`, `venv`) from every walk; fail-first tests incl. the freshness-discovery path | Probe D | **P1** | **COMPLETE** |
| **37.2** | Record the parallel-write collision with its demonstration and the fix options; no code change this phase | Probe F | **P2** | **COMPLETE** |
| **37.3** | Guardian gate, docs sync, record (incl. the live baseline) | — | **P0** | **COMPLETE** |

## 3. Task detail

### 37.1 — The exclusion set is the contract

One set, five walkers, so the fix is a single change with one test that pins the
contract for both discovery paths (initial build and the freshness walk) plus a
tripwire that a similarly-named real directory (`targets/`) stays indexed.

### 37.2 — The collision boundary, recorded

No fix in this phase: a correct fix is optimistic concurrency (a write refuses
when the file changed since the writer last read it) or worktree isolation per
parallel member; both are design work with their own phase. What ships now is
the receipt above and the options, so the boundary is visible rather than
discovered by a user losing work.

## 4. Declared boundaries (recorded, not hidden)

- **Symlinked directories are silently skipped by every walk.** Exposed by this
  probe: noteflow's `target` was assumed to be the cost anchor, but the real
  reason it is skipped is unrelated to exclusions — the walk only descends when
  `Dirent.isDirectory()` is true, and a symlinked directory is neither
  directory nor file. Harmless for build output; a **source** symlink would be
  invisible to `find_symbol`, `grep`, and `list_files`. No live instance found;
  the trigger to reopen is one.
- **The eval suite no longer differentiates frontier models.** Mercury's 96%
  live and the scripted lane's 25/25 both sit at the ceiling; a harder task tier
  (longer horizon, multi-turn, real-repo) is the next measurement investment.
- **Parallel mutating members can silently lose work** (Probe F). Until
  optimistic concurrency or worktrees land, the operational rule is: parallel
  teams partition paths, mutating collaboration goes through `pipeline`.
- **Free-tier quota remains environmental** (Phase 36): live lanes need a
  provider with quota; the failure now surfaces fast instead of stalling.

## 5. Method (unchanged, it keeps proving itself)

Probe before believing; discard an invalid probe rather than reason from it (this
phase's collision probe was invalid on the first run — the fake-provider script
shape was wrong and produced zero tool calls — and was rebuilt from the real
harness before any conclusion was drawn); a test counts as evidence only if it
fails against the pre-change code; measure, never infer, a number; declare what
remains open rather than implying it is handled.
