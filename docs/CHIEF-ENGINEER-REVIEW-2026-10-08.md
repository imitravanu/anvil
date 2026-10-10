# Chief-engineer deep dive — Anvil gate / eval / sentinel (2026-10-08)

> Mission: "make it frontier" on the gate, the eval harness and the sentinel.
> This is the assessment behind Batch O (checkpoint fidelity), with the findings
> that remain open and the next batches ranked. Method first: every claim below
> is either a read of the live tree at `eb45b9c` or a measurement run in this
> session — nothing is inferred from notes.

## 1. Baseline and evidence

| Fact | Value |
| --- | --- |
| HEAD at assessment start | `eb45b9c` (Batch N), tree clean, 68 commits ahead of origin |
| Gate authority | `scripts/verify-gate.mjs` v2.3, Steps 0 → 5 |
| Enforcement surfaces | gate (authority), pre-commit hook, in-process guardian, in-product `anvil gate` |
| Removal from the mission | no gate/eval/sentinel rule was weakened to land Batch O |

Read in this pass: the whole gate (768 lines), the hook (267), the sentinel
(464), `gate.ts` (333), the guardian scanner/rules/interceptor/health, the agent
loop (`session.ts`, `orchestrator.ts`, `turnStream.ts`, `turnVerifier.ts`,
`loopGuard.ts`, `guardianIntercept.ts`), the eval harness (`runner.ts`,
`experiment.ts`, `mockProvider.ts`, `evals/run.ts`, `evals/ab.ts`), the fixture
integrity suite, and `AGENTS.md` / `CURRENT-FOCUS.md` / `README.md` claims.

Measured probes (all reproducible with the repo's own artifacts):

1. Guardian vs gate, same text: `const z: <annotation> = 1;` and
   `e.message ?? String(e)` returned **zero** violations from the guardian while
   the gate's Step 1 rejects both (its own sentinel probes assert that).
2. In-product gate over a synthetic three-file diff (source, test, TUI): the old
   call reported `(working tree) 1`, `(working tree) 3`, `(working tree) 4` —
   a synthetic label and indices into the concatenated added text. The skipped
   test in the test file was **not** caught; the fixture cast in it **was**
   reported. Both are the opposite of the authority.
3. Untracked coverage: after `git commit`, a new `b.ts` holding a cast produced
   an **empty** `git diff HEAD --stat`, while `git status --porcelain` showed
   `?? b.ts` — the in-product gate scans the former.

## 2. What holds up (verified, not assumed)

- **Gate integrity is layered and adversarial.** Per-family Step 0 sensor
  probes (16/16, identity-based so a neutered rule fails its own probe);
  Step 0.5 hash manifest over 10 protected artifacts with
  `--ack-protected-change`; CI-aware diff base with untracked-file injection;
  allowlist shape validation plus exact-path suppression; Step 1.5 full-tree
  residual drain; `--quick` mode that runs Steps 0–1.5 in seconds.
- **The hook cannot be made attacker-controlled.** It never executes the
  worktree gate; it reads only `git diff --cached`, refuses protected paths
  itself, and ports the two shapes grep cannot express (multiline pairs,
  brace-aware silent catch) to POSIX awk — failing **open**, loudly, if awk is
  missing.
- **One exemption policy, three surfaces, pinned by drift tests.** Batch N's
  corpus in the sentinel drives the real extracted gate scanner and the real
  guardian over 12 rows × both path classes; the hook has its own differential
  suite that stages one corpus and compares refused sets against the real gate.
- **Eval lane honesty.** Fixtures are pinned RED (against pristine `setup/`) and
  GREEN (against `assertions/expected/`) in two directions, so a mock lane that
  is green by construction cannot inflate itself unnoticed; the A/B harness
  decides significance per task (not on the aggregate), interleaves arms within
  a trial, excludes provider errors by a STRUCTURED failure kind, and labels a
  mock run as not-evidence in the verdict line itself.
- **Loop safety where it is expensive to fix later.** History pairing repairs are
  idempotent and run on cancel and on generator return; rewind snapshots are
  committed only for writes that actually succeeded; loop refusal is decided
  before a session tool can execute; the read-only command safe-list records its
  bypass in the ledger rather than hiding it.

## 3. Findings

### F1 — the in-product gate had no file identity (FIXED in Batch O)

`scanWorkingTree`/`scanStaged`/`watchScan` handed one multi-file diff to
`scanDiffForSlop` under one synthetic label. Consequences, all measured:
reported location was an index into the concatenated added text; path-scoped
rules were judged against a label (test-path exemption, core boundary, TUI
colors); the test-path split was wrong in **both** directions. Fix: a core
resolver (`parseUnifiedDiffSections` + `scanUnifiedDiffForSlop`) that maps every
added line to its real file and real new-file line, with a loud fallback section
for lines a malformed diff never gave a file header; the CLI gate calls it. The
sentinel now pins the resolved verdicts and the wiring.

### F2 — the guardian was thinner than the gate (FIXED in Batch O)

The guardian carried neither the gate's bare-annotation family (the four
annotation positions a cast rule cannot see) nor its nullish raw-error fallback.
Those two were the only families where a write could pass the pre-write
checkpoint and be refused later at commit time. Fix: both rules added to the
scanner (annotation family universal, fallback anvil-scoped like its sibling),
the sentinel corpus widened to 14 rows, and the guardian's own suite grown to 46
tests with fail-first receipts against HEAD's scanner.

### F3 — `anvil gate` cannot see untracked files (OPEN)

The product command scans `git diff HEAD` (and `--staged` scans the index), so a
brand-new file is invisible until it is added: measured empty diff for an
untracked dirty `b.ts`. The repo gate solved this years ago with
`git ls-files --others --exclude-standard` injected as synthetic sections; the
product surface never inherited it. Impact: the most common first act of slop —
a new file — is the one thing `anvil gate` (and `--watch`, which re-scans the
same surface) does not report. Fix sketch: add the untracked pass to
`scanGitDiff`, build the same synthetic `+++` sections, and feed them through
`scanUnifiedDiffForSlop` — the resolver now makes that a few lines, and the
banner already promises "working-tree diff vs HEAD".

### F4 — A/B evidence is printed, not persisted (OPEN)

`runPromptExperiment` returns a structured `AbResult` (arms, trials,
significance, verdict) and `evals/ab.ts` prints it, but nothing writes an
artifact. The only surviving record of a prompt experiment is CI stdout, and
`evals/run.ts --report` (which reads batch reports) cannot surface it. For a
project whose constitution says "measure never infer", the measurement of its
own prompt is the one decision with no durable receipt.

### F5 — notes and scope boundaries (verified, not defects)

- Step 1.5 (full-tree residual drain) exists only in `npm run gate`; the
  in-product gate is a diff tool and says so in the watch banner.
- The sentinel extracts the gate's scanner with regexes anchored on column-0
  `}`. It fails loudly (`toBeTruthy`) rather than silently, and the manifest +
  protected cycle means a hand-edited gate is a reviewed change — brittle in
  the safe direction, worth a comment rather than a redesign.
- Linux watch covers the top two levels (documented in code); deeper trees
  rescan on the next save via the diff, not the fs event.

## 4. Frontier thesis and next batches

The three systems are past "does it work". The remaining frontier is
**checkpoint fidelity** — every enforcement surface judging exactly what the
authority judges, at the right coordinates — and **evidence persistence**.
Ranked:

1. **Batch O (landed here).** Per-file resolution + the two missing rule
   families. The in-product gate now names real files and real lines and applies
   the authority's path split; the guardian is no longer thinner than the gate.
2. **Batch P — close F3.** Untracked files in the in-product gate (and thus in
   watch mode), reusing the resolver; prove it end-to-end through `runNativeGate`
   and pin the verdicts against the authority's untracked pass.
3. **Batch Q — close F4.** Persist `AbResult` artifacts next to eval reports and
   teach `--report` to read them, so a prompt decision is auditable and a later
   change can be compared against the run that justified the current prompt.
4. **Strategic bet: one rule catalog, two engines.** The gate is plain `.mjs`
   that must run before any build, and core is shipped TS — so the rules exist
   twice, kept in sync by drift tests. A machine-readable rule catalog (JSON)
   consumed by both the gate and the scanner would delete the drift class
   itself, at the cost of a protected-artifact redesign and a real risk of
   weakening a gate that currently has no known divergence. Only worth it if a
   third engine ever appears.
