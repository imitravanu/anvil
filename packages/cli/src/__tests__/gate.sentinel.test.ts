import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { isValidSourceFilePath, scanTextForSlop, scanUnifiedDiffForSlop } from "@anvil/core";

/**
 * GATE INTEGRITY SENTINEL (hardening, 2026-09-13)
 *
 * The gate (scripts/verify-gate.mjs) is itself a repo artifact that an agent
 * with write access could weaken. This test lives OUTSIDE the gate, in the
 * normal vitest suite, and asserts the gate still:
 *   - enforces every anti-slop rule regex,
 *   - fails hard (no silent skips / no-op steps),
 *   - scans untracked files and CI merge-base diffs (no blind spots),
 *   - validates the allowlist shape (no weaponized broad entries),
 *   - wires the integrity manifest + protected-path acknowledgement.
 * CI runs `npm test` independently of `npm run gate`, so gutting the gate
 * without also gutting this test fails CI.
 *
 * NOTE: this file is itself a protected artifact (hashed in
 * scripts/gate-manifest.json). Intentional changes REQUIRE the manifest update
 * in the same commit + human review (the gate refuses locally without
 * --ack-protected-change).
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../");
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), "utf-8");

/**
 * Extract the gate's REAL `scanLinesForViolations`, plus the helpers it calls,
 * from its source and evaluate them — behavioral probes rather than a
 * restatement of the regex text (G2). Shared by the rule-family probe and the
 * Batch N exemption-policy parity test; the existence assertions live here so a
 * gate that stops defining any of these fails both callers.
 */
function gateScanner(): (lines: string[]) => string[] {
  const gate = read("scripts/verify-gate.mjs");
  const isCommentSrc = gate.match(/const isCommentLine = [^\n]+/)?.[0];
  const magicSrc = gate.match(/const MAGIC_TIMEOUT_RE =[\s\S]*?;/)?.[0];
  const surfacesSrc = gate.match(/const CATCH_SURFACES_RE = [^\n]+/)?.[0];
  const braceSrc = gate.match(/function matchBraceBody\(text, openIdx\) \{[\s\S]*?\n\}/)?.[0];
  const silentSrc = gate
    .match(/export function silentCatchLines\(text\) \{[\s\S]*?\n\}/)?.[0]
    ?.replace(/^export /, "");
  const scanSrc = gate.match(/function scanLinesForViolations\(diffLines\) \{[\s\S]*?\n\}/)?.[0];
  expect(isCommentSrc, "gate must define isCommentLine").toBeTruthy();
  expect(magicSrc, "gate must define MAGIC_TIMEOUT_RE").toBeTruthy();
  expect(surfacesSrc, "gate must define CATCH_SURFACES_RE").toBeTruthy();
  expect(braceSrc, "gate must define matchBraceBody").toBeTruthy();
  expect(silentSrc, "gate must define silentCatchLines").toBeTruthy();
  expect(scanSrc, "gate must define scanLinesForViolations").toBeTruthy();
  return new Function(
    `${isCommentSrc}\n${magicSrc}\n${surfacesSrc}\n${braceSrc}\n${silentSrc}\n${scanSrc}\nreturn scanLinesForViolations;`
  )() as (lines: string[]) => string[];
}

describe("gate integrity sentinel", () => {
  it("gate script exists and is non-empty", () => {
    const gate = read("scripts/verify-gate.mjs");
    expect(gate.length).toBeGreaterThan(2000);
  });

  it("every anti-slop rule family is ENFORCED (behavioral, not source text)", () => {
    // G2 (AUDIT-2026-09-30): the old test asserted literal substrings
    // (`toContain("borderColor|backgroundColor")`), so a rule neutered to
    // `if (false)` still passed. Extract the real scanner and assert each
    // family actually fires. A disabled rule now fails the probe that exists to
    // catch it.
    const scan = gateScanner();

    const CORE = "+++ b/packages/core/src/probe.ts";
    const TUI = "+++ b/packages/tui/src/components/Probe.tsx";
    const probes: Array<{ label: string; lines: string[] }> = [
      { label: "as any", lines: [CORE, "+ const x = data as any;"] },
      { label: "as never", lines: [CORE, "+ const y = data as never;"] },
      { label: "empty catch", lines: [CORE, "+ try { a(); } catch {}"] },
      { label: "raw error ternary", lines: [CORE, "+ const m = err instanceof Error ? err.message : String(err);"] },
      { label: "?.message ?? String", lines: [CORE, "+ const m = e.message ?? String(e);"] },
      { label: "bare any annotation", lines: [CORE, "+ const z: any = 1;"] },
      { label: "comma-position any (G3a)", lines: [CORE, "+ const m: Record<string, any> = {};"] },
      { label: "core imports tui", lines: [CORE, "+ import { App } from '@anvil/tui';"] },
      { label: "placeholder marker", lines: [CORE, "+ // TODO: finish later"] },
      { label: "hardcoded TUI color", lines: [TUI, '+ <Box color="cyan" />'] },
      { label: "ts-ignore suppression", lines: [CORE, "+ // @ts-ignore"] },
      { label: "ts-nocheck suppression", lines: [CORE, "+ // @ts-nocheck"] },
      { label: "skipped test", lines: ["+++ b/packages/core/src/__tests__/probe.test.ts", '+ it.skip("test", () => {});'] },
      { label: "as Error cast (H1)", lines: [CORE, "+ const m = (err as Error).message;"] },
      { label: "magic timeout literal (H1)", lines: [CORE, "+ const r = fetch(url, { timeout: 5000 });"] },
      { label: "magic exponent base, expression shape (rule 2.4)", lines: [CORE, "+ const d = BASE_MS * Math.pow(2, attempt);"] },
      { label: "silent non-empty catch (H1)", lines: [CORE, "+ try { a(); } catch { b = 1; }"] },
    ];
    for (const probe of probes) {
      expect(scan(probe.lines).length, `gate must flag: ${probe.label}`).toBeGreaterThan(0);
    }
    // Negative controls: a clean line and a comment that merely names a pattern
    // must NOT be flagged.
    expect(scan([CORE, "+ const ok: string = 'hi';"])).toEqual([]);
    // A NAMED exponent base is the fix, not a violation.
    expect(scan([CORE, "+ const d = BASE_MS * Math.pow(BACKOFF_BASE, attempt);"])).toEqual([]);
    expect(scan([CORE, "+ // this prose mentions as any but is not code"])).toEqual([]);
  });

  it("comment-awareness guard is present for the code rules (S5.3 precision)", () => {
    const gate = read("scripts/verify-gate.mjs");
    // A comment cannot execute; without this guard the gate flagged doc
    // comments that merely described the package boundary (and prose with
    // ": any"). The placeholder rule stays comment-visible by design.
    expect(gate).toContain("isCommentLine");
    expect(gate).toContain("!comment &&");
    // The Step 1.5 residual loop must carry the same guard, exempting only the
    // placeholder marker (".`TODO` in a comment is the target, not a false positive").
    expect(gate).toContain("lineIsComment");
    expect(gate).toContain('rule.name !== "placeholder marker (TODO/FIXME/XXX)"');
  });

  it("failure wiring is intact (gate cannot be no-op'd)", () => {
    const gate = read("scripts/verify-gate.mjs");
    expect(gate).toContain("process.exit(1)");
    expect(gate).toContain("function fail(");
    expect(gate).toContain("function pass(");
    expect(gate).toContain("logStep(0");
    expect(gate).toContain("logStep(5");
  });

  it("diff scanning has no blind spots (CI-aware base, untracked files, no silent skip)", () => {
    const gate = read("scripts/verify-gate.mjs");
    expect(gate).toContain("git diff");
    expect(gate).toContain("ls-files --others --exclude-standard");
    expect(gate).toContain("GITHUB_BASE_REF");
    expect(gate).not.toContain("Git diff scan skipped or no changes detected");
  });

  // G1 (AUDIT-2026-09-30): the diff pathspec and the residual walk both omitted
  // root scripts/, evals/ and packages/*/scripts/*.mjs — hiding live slop in
  // scripts/audit-qwen.ts and packages/tui/scripts/visual-diff.mjs. Both lists
  // are now derived from the same SCAN_ROOTS constant, so covering them is a
  // property of the source, pinned behaviorally below.
  it("both scanners cover scripts/, evals/ and packages/*/scripts (G1)", () => {
    const gate = read("scripts/verify-gate.mjs");
    const rootsSrc = gate.match(/const SCAN_ROOTS = \[[\s\S]*?\];/)?.[0];
    expect(rootsSrc, "gate must define SCAN_ROOTS").toBeTruthy();
    const roots = new Function(`${rootsSrc}\nreturn SCAN_ROOTS;`)() as string[];
    for (const required of ["scripts", "evals", "packages/tui/scripts", "packages/cli/src"]) {
      expect(roots, `SCAN_ROOTS must include ${required}`).toContain(required);
    }
    // The diff pathspec must be DERIVED from SCAN_ROOTS, not written out again.
    expect(gate).toMatch(/PATHSPEC = \[[\s\S]*SCAN_ROOTS/);
    // The residual walk must use the same constant.
    expect(gate).toMatch(/for \(const d of SCAN_ROOTS\) walkSourceFiles/);
    // Fixture scenario data and the gate's own rule-data must be exempt.
    expect(gate).toContain("SCAN_EXCLUDED_DIRS");
    expect(gate).toContain("RESIDUAL_SELF_EXEMPT");
  });

  // G3c (AUDIT-2026-09-30): a NEW workflow file used to escape tamper detection
  // (the manifest/hook enumerate only today's files). Protected-path matching
  // must treat `.github/workflows/` as a directory prefix.
  it("protected-path detection covers any workflow via a directory prefix (G3c)", () => {
    const gate = read("scripts/verify-gate.mjs");
    const fnSrc = gate.match(/function isProtectedPath\(relPath\) \{[\s\S]*?\n\}/)?.[0];
    expect(fnSrc, "gate must define isProtectedPath").toBeTruthy();
    // PROTECTED_PATHS is referenced by the function; supply the real list.
    const pathsSrc = gate.match(/const PROTECTED_PATHS = \[[\s\S]*?\];/)?.[0];
    const isProtected = new Function(
      `${pathsSrc}\n${fnSrc}\nreturn isProtectedPath;`
    )() as (rel: string) => boolean;
    expect(isProtected(".github/workflows/brand-new.yml")).toBe(true);
    expect(isProtected(".github/workflows/ci.yml")).toBe(true);
    expect(isProtected("scripts/verify-gate.mjs")).toBe(true);
    expect(isProtected("packages/cli/src/index.tsx")).toBe(false);
  });

  it("integrity manifest and protected-path gates are wired", () => {
    const gate = read("scripts/verify-gate.mjs");
    expect(gate).toContain("gate-manifest.json");
    expect(gate).toContain("--ack-protected-change");
    expect(gate).toContain("PROTECTED_PATHS");
  });

  // G3b (AUDIT-2026-09-30): allowlist suppression must compare the violation's
  // FILE PATH exactly. The old filter used `message.includes(entry.file)`, so
  // an entry for `src/a.ts` also suppressed `src/a.tsx`.
  it("allowlist suppression is exact-path, not substring (G3b)", () => {
    const gate = read("scripts/verify-gate.mjs");
    const fnSrc = gate.match(/function fileOfViolation\(message\) \{[\s\S]*?\n\}/)?.[0];
    expect(fnSrc, "gate must define fileOfViolation").toBeTruthy();
    const fileOfViolation = new Function(`${fnSrc}\nreturn fileOfViolation;`)() as (
      m: string
    ) => string;
    expect(fileOfViolation("src/a.ts: Bare any annotation \"x\" (Rule 2.2)")).toBe("src/a.ts");
    expect(fileOfViolation("src/a.tsx: Bare any annotation \"x\"")).toBe("src/a.tsx");
    // The obsolete substring form must be gone.
    expect(gate).not.toContain("v.includes(e.file)");
  });

  it("allowlist cannot be weaponized (entry shape is validated)", () => {
    const gate = read("scripts/verify-gate.mjs");
    expect(gate).toContain("isValidSourceFilePath");
  });

  // AUDIT-05: the gate (plain .mjs, repo-only) and core's shipped reader must
  // agree on what an allowlist entry is. A shared module is impossible — the
  // gate runs before any build and core is a shipped npm artifact — so the
  // gate's predicate is extracted from its source and pinned to core's
  // exported implementation. If either drifts, this fails on both.
  it("gate and core agree exactly on the allowlist entry shape", () => {
    const gate = read("scripts/verify-gate.mjs");
    const match = gate.match(/function isValidSourceFilePath\(file\) \{([\s\S]*?)\n\}/);
    expect(match, "gate must define isValidSourceFilePath").not.toBeNull();
    const gateFn = new Function("file", `${match![1]}\nreturn isValidSourceFilePath(file);`) as (
      file: unknown
    ) => boolean;

    const accept = [
      "packages/core/src/x.ts",
      "packages/tui/src/a/b/c.mjs",
      "src/legacy.ts",
      "app/page.tsx",
    ];
    const reject = [
      "",
      "packages",
      "packages/core/src",
      "packages/core/src/",
      "packages/core/src/*.ts",
      "/etc/x.ts",
      "../outside/x.ts",
      "packages/core/src/./x.ts",
      "packages\\core\\src\\x.ts",
      "README.md",
      "src/notes.txt",
      "lib/util.py",
    ];

    for (const file of accept) {
      expect(gateFn(file), `gate should accept ${file}`).toBe(true);
      expect(isValidSourceFilePath(file), `core should accept ${file}`).toBe(true);
    }
    for (const file of reject) {
      expect(gateFn(file), `gate should reject ${file}`).toBe(false);
      expect(isValidSourceFilePath(file), `core should reject ${file}`).toBe(false);
    }
  });

  it("constitution has not been watered down", () => {
    const agents = read("AGENTS.md");
    expect(agents).toContain("npm run gate");
    expect(agents).toContain("Anti-Slop");
    expect(agents).toContain("getErrorMessage");
    expect(agents).toContain("PHASE-21-25-AUDIT.md");
    expect(agents).toContain("Protected Artifact");
    // Batch N: the exemption policy the three checkpoints implement is written
    // down exactly once, in the constitution, and pinned here so it cannot be
    // silently dropped while the code keeps depending on it.
    expect(agents).toContain("TEST-FILE EXEMPTION POLICY");
  });

  it("integrity manifest covers every protected artifact and matches live content", () => {
    const manifest = JSON.parse(read("scripts/gate-manifest.json"));
    const required = [
      "scripts/verify-gate.mjs",
      "AGENTS.md",
      ".fresh-allowlist.json",
      "docs/PHASE-21-25-AUDIT.md",
      "packages/cli/src/__tests__/gate.sentinel.test.ts",
      ".githooks/pre-commit",
      ".github/workflows/ci.yml",
      ".github/workflows/live-eval.yml",
      ".github/workflows/release.yml",
      ".github/workflows/visual-regression.yml",
    ];
    expect(manifest.hashes).toBeTypeOf("object");
    // Exact coverage: a protected file must never be drafted out of the manifest.
    expect(Object.keys(manifest.hashes).sort()).toEqual(required.sort());
    for (const rel of required) {
      const stored = manifest.hashes[rel];
      expect(stored).toMatch(/^[0-9a-f]{64}$/);
      const live = createHash("sha256").update(read(rel)).digest("hex");
      expect(live, `live hash of ${rel} drifts from the committed manifest`).toBe(stored);
    }
  });

  it("residual drain scan (Step 1.5) is wired and allowlist-free", () => {
    const gate = read("scripts/verify-gate.mjs");
    expect(gate).toContain("STEP 1.5");
    expect(gate).toContain("RESIDUAL_RULES");
    expect(gate).toContain("walkSourceFiles");
    expect(gate).toContain(".message\\s*\\?\\?\\s*String\\(");
    expect(gate).toContain("type escape (as any/never)");
    expect(gate).toContain("type escape (bare any annotation)");
    expect(gate).toContain("placeholder marker (TODO/FIXME/XXX)");
    expect(gate).toContain("core boundary breach");
    expect(gate).toContain("Full-tree residual scan clean");
    // Residual debt must not be suppressible via the allowlist.
    expect(gate.indexOf("STEP 1.5")).toBeLessThan(gate.indexOf("Full-tree residual scan clean"));
  });

  it("commit-time enforcement (pre-commit hook) is self-contained and attacker-proof", () => {
    const hook = read(".githooks/pre-commit");
    // PROVEN ATTACK: a hook that executes scripts/verify-gate.mjs is
    // attacker-controlled (the agent weakens the script AND flips its exit
    // code). The hook must decide from the staged diff alone.
    expect(hook).not.toMatch(/exec\s+.*verify-gate\.mjs/);
    expect(hook).not.toMatch(/node\s+scripts\/verify-gate\.mjs/);
    expect(hook).toContain("git diff --cached --name-only");
    expect(hook).toContain("PROTECTED ARTIFACT CHANGE DETECTED");
    expect(hook).toContain("exit 1");
    expect(hook).toContain("any|never"); // slop scan layer present
    expect(hook).toContain("TODO|FIXME|XXX"); // placeholder layer present
    expect(hook).toContain("@anvil/(tui|cli)"); // arch heuristic present
    // The skipped-test rule is path-scoped, mirroring gate Step 1, the residual
    // scan, and the in-process guardian: outside a test file a skipped block
    // has nothing to skip, so judging prose there is a pure false positive —
    // a source file that must NAME the pattern was refused at commit time
    // while `npm run gate` passed. Both halves are pinned: the rule, and the
    // predicate that decides who it judges.
    expect(hook).toContain("*__tests__*|*.test.*");
    expect(hook).toContain("it|test|describe");
    expect(hook).toContain("xit|xtest|xdescribe");
    // One failure path, still loud and still refusing.
    expect(hook).toContain("SLOP PATTERNS DETECTED IN STAGED FILES");
    expect(hook).not.toContain("(hook) skipped test");
    // The hook must never smuggle the human-ack flag: a protected change must
    // always require the explicit flag (or --no-verify, which is loud).
    expect(hook).not.toContain("--ack-protected-change");
    const gate = read("scripts/verify-gate.mjs");
    expect(gate).toContain(".githooks/pre-commit"); // protected path coverage
  });

  it("the hook mirrors the gate's scan roots, extensions and path split (Batch M parity)", () => {
    const gate = read("scripts/verify-gate.mjs");
    const hook = read(".githooks/pre-commit");
    const rootsBlock = gate.match(/const SCAN_ROOTS = \[([\s\S]*?)\];/)?.[1] ?? "";
    const extsBlock = gate.match(/const SCAN_EXTS = \[([^\]]*)\]/)?.[1] ?? "";
    const roots = [...rootsBlock.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    const exts = [...extsBlock.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(roots.length, "gate must declare its scan roots").toBeGreaterThan(4);
    expect(exts.length, "gate must declare its scan extensions").toBeGreaterThan(3);
    // A root or extension the gate gains that the hook never learns is silent
    // UNDER-coverage: the hook would accept a line the gate rejects. Behavior
    // is proven in packages/cli/src/__tests__/preCommitHook.test.ts; this pins
    // the static shape so a new root cannot slip through unnoticed.
    for (const root of roots) expect(hook, `hook must scan ${root}`).toContain(root);
    for (const ext of exts) expect(hook, `hook must scan *.${ext}`).toContain(`*.${ext}`);
    // The gate's fixture exclusion and its two Step-1 self-exempt paths.
    expect(hook).toContain("evals/tasks/*");
    expect(hook).toContain("scripts/verify-gate.mjs");
    expect(hook).toContain("packages/cli/src/__tests__/gate.sentinel.test.ts");
    // One predicate, the gate's: a test path is judged by the skipped-test rule
    // alone. Getting this wrong is the false positive Batch M removed.
    expect(hook).toContain("*__tests__*|*.test.*");
    // The two checks grep cannot express are ported rather than dropped.
    expect(hook).toContain("PARITY_AWK");
  });

  // Batch N: ONE test-file exemption policy, implemented by three checkpoints
  // (the gate's Step 1, the pre-commit hook's Layer B, and the in-process
  // guardian). A test path is judged by the skipped-test rule ALONE; every other
  // built-in family is exempt there, because a fixture legitimately needs casts,
  // silent catches, marker strings and inline timing literals to reproduce the
  // failure it pins. The guardian used to carry a NARROWER exemption — it judged
  // empty catches, raw error formatting, marker strings, magic literals,
  // boundary imports and TUI colors in test files the gate accepts, so the
  // in-process checkpoint nagged about work the commit gate blessed. This drives
  // the real gate scanner and the real guardian over one corpus and fails if
  // their verdicts ever diverge again (the gate's Step 2 build makes the guardian
  // module under test the current source, as with the allowlist parity above).
  it("one test-file exemption policy across the gate, the hook and the guardian (Batch N)", () => {
    const gate = read("scripts/verify-gate.mjs");
    const hook = read(".githooks/pre-commit");
    const scan = gateScanner();
    const CORE_SRC = "packages/core/src/probe.ts";
    const CORE_TEST = "packages/core/src/__tests__/probe.test.ts";
    const TUI_SRC = "packages/tui/src/components/Probe.tsx";
    const TUI_TEST = "packages/tui/src/components/__tests__/Probe.test.tsx";
    const gateRejects = (rel: string, text: string): boolean =>
      scan([`+++ b/${rel}`, `+ ${text}`]).length > 0;
    const guardianRejects = (rel: string, text: string): boolean =>
      scanTextForSlop(rel, text, "anvil").length > 0;

    // Every family all three checkpoints implement is judged here, in both
    // directions, on both path classes. Batch O closed the last rule gap — the
    // gate alone carried the bare-annotation and nullish-fallback families — so
    // the corpus is now the full built-in set the three surfaces share.
    const corpus: Array<{
      label: string;
      srcRel: string;
      testRel: string;
      text: string;
      testOnly?: boolean;
    }> = [
      { label: "as-any cast", srcRel: CORE_SRC, testRel: CORE_TEST, text: "const x = data as any;" },
      { label: "as-never cast", srcRel: CORE_SRC, testRel: CORE_TEST, text: "const y = data as never;" },
      { label: "as Error cast", srcRel: CORE_SRC, testRel: CORE_TEST, text: "const m = (err as Error).message;" },
      { label: "empty catch", srcRel: CORE_SRC, testRel: CORE_TEST, text: "try { a(); } catch {}" },
      { label: "raw error ternary", srcRel: CORE_SRC, testRel: CORE_TEST, text: "const m = err instanceof Error ? err.message : String(err);" },
      { label: "bare any annotation", srcRel: CORE_SRC, testRel: CORE_TEST, text: "const z: " + "any = 1;" },
      { label: "nullish raw-error fallback", srcRel: CORE_SRC, testRel: CORE_TEST, text: "const m = e." + "message ?? String(e);" },
      { label: "TypeScript suppression", srcRel: CORE_SRC, testRel: CORE_TEST, text: "// @ts-ignore" },
      { label: "placeholder marker", srcRel: CORE_SRC, testRel: CORE_TEST, text: "// TODO: later" },
      { label: "magic timeout literal", srcRel: CORE_SRC, testRel: CORE_TEST, text: "const r = fetch(url, { timeout: 5000 });" },
      { label: "core boundary import", srcRel: CORE_SRC, testRel: CORE_TEST, text: "import { App } from '@anvil/tui';" },
      { label: "hardcoded TUI color", srcRel: TUI_SRC, testRel: TUI_TEST, text: '<Box color="cyan" />' },
      { label: "silent non-empty catch", srcRel: CORE_SRC, testRel: CORE_TEST, text: "try { a(); } catch { b = 1; }" },
      { label: "skipped test", srcRel: CORE_SRC, testRel: CORE_TEST, text: 'it.skip("test", () => {});', testOnly: true },
    ];
    for (const row of corpus) {
      // [gate.src, guardian.src, gate.test, guardian.test] — the whole policy in
      // one assertion: the checkpoints must agree, in both directions.
      expect(
        [
          gateRejects(row.srcRel, row.text),
          guardianRejects(row.srcRel, row.text),
          gateRejects(row.testRel, row.text),
          guardianRejects(row.testRel, row.text),
        ],
        `${row.label}: gate/guardian verdicts must match on both path classes`
      ).toEqual(row.testOnly ? [false, false, true, true] : [true, true, false, false]);
    }

    // Batch O+ (chief-engineer takeover, 2026-10-10): the array position of the
    // bare-annotation family must be the authority's EMPTY pair. The scanner
    // transcribed `any[` — refusing legal indexed access (`conf.any[0]`) on
    // source paths while the gate blessed it, and the pre-commit hook carried
    // the same typo. Pinned in both directions; the RED run of the
    // indexed-access row against the pre-fix guardian is the receipt.
    expect(gateRejects(CORE_SRC, "const v = conf.any[0];"), "indexed access is not an annotation").toBe(false);
    expect(guardianRejects(CORE_SRC, "const v = conf.any[0];"), "the guardian must agree with the gate").toBe(false);
    expect(gateRejects(CORE_SRC, "const arr: " + "any[] = [];"), "the empty pair IS an annotation").toBe(true);
    expect(guardianRejects(CORE_SRC, "const arr: " + "any[] = [];"), "the guardian must agree with the gate").toBe(true);

    // The split-across-two-lines family lives in a Step-1 block OUTSIDE the
    // extracted scanner, so it is pinned by its path predicate plus a behavioral
    // probe on the guardian, which carries the pair scan in-process.
    expect(gate).toContain(
      'if (file.includes("__tests__") || file.includes(".test.") || file === "scripts/verify-gate.mjs") continue;'
    );
    const splitCast = "const x = data as\n" + "  an" + "y;";
    expect(guardianRejects(CORE_TEST, splitCast), "a split cast is exempt in a test path").toBe(false);
    expect(guardianRejects(CORE_SRC, splitCast), "a split cast is still judged on a source path").toBe(true);

    // The hook implements the same split, and it names the suite that guards it:
    // a pointer to a renamed file is rot, not documentation.
    expect(hook).toContain("*__tests__*|*.test.*");
    const named = [...hook.matchAll(/packages\/cli\/src\/__tests__\/[A-Za-z0-9_.-]+\.test\.ts/g)].map((m) => m[0]);
    expect(named.length, "the hook must name the parity suite that guards it").toBeGreaterThan(0);
    for (const rel of named) {
      expect(fs.existsSync(path.join(ROOT, rel)), `the hook points at a missing suite: ${rel}`).toBe(true);
    }
  });

  // Batch O: the in-product `anvil gate` is a fourth surface on the same
  // policy. It resolves a diff per file BEFORE judging: one synthetic label for
  // a whole multi-file diff made every path-aware decision wrong in one
  // direction or the other (a fixture cast in a test file was refused while a
  // skipped test was not caught), and reported an index into the concatenated
  // added text as if it were a file line. Resolution is the only new layer — it
  // feeds the same scanner the guardian uses — so this pins the verdicts AND
  // the wiring.
  it("the in-product gate resolves a diff per file before judging (Batch O)", () => {
    const diff = [
      "+++ b/packages/core/src/probe.ts",
      "@@ -0,0 +1,2 @@",
      "+const ok = 1;",
      "+const y = data as " + "any;",
      "+++ b/packages/core/src/__tests__/probe.test.ts",
      "@@ -0,0 +1,2 @@",
      "+const fixture = data as " + "any;",
      "+" + "it." + 'skip("test", () => {});',
    ].join("\n");
    const violations = scanUnifiedDiffForSlop(diff, "anvil");
    const at = (file: string, line: number, rule: string): boolean =>
      violations.some((v) => v.file === file && v.line === line && v.rule === rule);
    // Real path, real line — and the split the authority enforces: the fixture
    // cast on the test path is exempt, the skip on it is caught.
    expect(at("packages/core/src/probe.ts", 2, "no-as-any"), "the source cast must be reported at its own line").toBe(true);
    expect(
      at("packages/core/src/__tests__/probe.test.ts", 2, "no-skipped-test"),
      "a skipped test must be caught on its real line"
    ).toBe(true);
    expect(
      violations.some((v) => v.file.endsWith("probe.test.ts") && v.rule !== "no-skipped-test"),
      "a test path is judged by the skipped-test rule alone"
    ).toBe(false);
    // The authority's own scanner agrees, per path class, on the same text.
    const scan = gateScanner();
    expect(scan(["+++ b/packages/core/src/probe.ts", "+ const y = data as " + "any;"]).length).toBeGreaterThan(0);
    expect(scan(["+++ b/packages/core/src/__tests__/probe.test.ts", "+ const fixture = data as " + "any;"]).length).toBe(0);
    // Wiring: the CLI gate must call the resolver, never hand a whole
    // multi-file diff to the one-file helper under a synthetic label.
    const cli = read("packages/cli/src/gate.ts");
    expect(cli).toContain("scanUnifiedDiffForSlop");
    expect(cli).not.toContain("scanDiffForSlop(");
  });

  it("CI still enforces tests, the gate, and full clone depth", () => {
    const ci = read(".github/workflows/ci.yml");
    expect(ci).toContain("npm test");
    expect(ci).toContain("npm run gate");
    expect(ci).toContain("fetch-depth: 0");
  });

  // G16 (AUDIT-2026-09-30): dispatch inputs must not be interpolated into the
  // secret-bearing shell block. They arrive via env and are consumed as a
  // quoted bash array.
  it("live-eval workflow passes dispatch inputs via env, not shell interpolation (G16)", () => {
    const wf = read(".github/workflows/live-eval.yml");
    expect(wf).not.toMatch(/--provider \$\{\{\s*inputs\.provider/);
    expect(wf).not.toMatch(/--model \$\{\{\s*inputs\.model/);
    expect(wf).toContain("DISPATCH_PROVIDER: ${{ inputs.provider }}");
    expect(wf).toContain("DISPATCH_MODEL: ${{ inputs.model }}");
    expect(wf).toContain('FLAGS+=(--provider "$DISPATCH_PROVIDER")');
    expect(wf).toContain('FLAGS+=(--model "$DISPATCH_MODEL")');
  });

  it("gate supports --version reporting and is v2.3", () => {
    const gate = read("scripts/verify-gate.mjs");
    expect(gate).toContain('GATE_VERSION = "2.3"');
    expect(gate).toContain("--version");
  });
});