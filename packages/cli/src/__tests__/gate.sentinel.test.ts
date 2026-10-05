import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { isValidSourceFilePath } from "@anvil/core";

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
    const gate = read("scripts/verify-gate.mjs");
    const isCommentSrc = gate.match(/const isCommentLine = [^\n]+/)?.[0];
    // H1: scanLinesForViolations now calls the shared helpers, so they must be
    // injected into the evaluated function too — otherwise the extracted
    // scanner would throw a ReferenceError the moment a probe reaches them.
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
    const scan = new Function(
      `${isCommentSrc}\n${magicSrc}\n${surfacesSrc}\n${braceSrc}\n${silentSrc}\n${scanSrc}\nreturn scanLinesForViolations;`
    )() as (lines: string[]) => string[];

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
      { label: "silent non-empty catch (H1)", lines: [CORE, "+ try { a(); } catch { b = 1; }"] },
    ];
    for (const probe of probes) {
      expect(scan(probe.lines).length, `gate must flag: ${probe.label}`).toBeGreaterThan(0);
    }
    // Negative controls: a clean line and a comment that merely names a pattern
    // must NOT be flagged.
    expect(scan([CORE, "+ const ok: string = 'hi';"])).toEqual([]);
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
    // The hook must never smuggle the human-ack flag: a protected change must
    // always require the explicit flag (or --no-verify, which is loud).
    expect(hook).not.toContain("--ack-protected-change");
    const gate = read("scripts/verify-gate.mjs");
    expect(gate).toContain(".githooks/pre-commit"); // protected path coverage
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