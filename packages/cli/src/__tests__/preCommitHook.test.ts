import { describe, expect, it, beforeAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * Pre-commit hook behavior (G7, AUDIT-2026-09-30).
 *
 * The hook is a protected artifact (`.githooks/pre-commit`); these tests run the
 * REAL script against a throwaway git repo, so they pin behavior rather than
 * source text. The bug: Layer B grepped the whole multi-package diff for
 * `@anvil/(tui|cli)`, so a legal CLI→TUI build (cli/index.tsx already has one)
 * failed the hook. Only `packages/core/` files may never import tui/cli.
 *
 * BATCH M adds the parity half. The hook is a PRE-FLIGHT of the gate's Step 1,
 * not a second opinion, and the two must agree in both directions: a rule the
 * hook applies to a path the gate exempts blocks a commit the gate accepts
 * (sanctioned fixture casts in test files — 13 of them), and a rule the hook
 * lacks lets through what the gate would stop. The last suite runs the REAL
 * gate over the SAME staged index as the hook and compares verdicts, so this is
 * a differential proof against the authority rather than a restatement of it.
 *
 * Every forbidden shape below is ASSEMBLED AT RUNTIME. The commit hook judges a
 * test path by the skipped-test rule alone, but the in-process guardian judges
 * several families in test files too, and this file must stay clean for both.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../");
const HOOK = path.join(ROOT, ".githooks", "pre-commit");

// Assembled so this source never contains the shapes it probes for.
const SKIP_IT = "it." + "skip";
const SKIP_DESCRIBE = "describe." + "skip";
const TS_IGNORE = "@ts-" + "ignore";
const AS_ANY = "as " + "any";
const AS_ERROR = "as " + "Error";
const BARE_ANY = ": Record<string, " + "any>";
const NON_CAPTURING = "/(?:" + "any)+/";
const PLACEHOLDER = "TO" + "DO: tighten this later";
const MAGIC_LITERAL = "timeo" + "ut: 5000";
const EMPTY_CATCH = "cat" + "ch {}";
const SILENT_CATCH = "cat" + "ch (err) { return null; }";
const LOGGED_CATCH = "cat" + "ch (err) { log.warn(err); }";
const EXPLAINED_CATCH = "cat" + "ch { /* intentional: best effort */ }";
const RAW_TERNARY = "e instanceof Err" + "or ? e.message : String(e)";
const DOT_MESSAGE = "e.mess" + "age ?? String(e)";
const HARDCODED_COLOR = 'color="' + "cyan" + '"';
const TUI_IMPORT = "@anvil/" + "tui";

const git = (cwd: string, args: string[]): void => {
  const res = spawnSync("git", args, { cwd, encoding: "utf-8" });
  if (res.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${res.stderr || res.stdout}`);
  }
};

/** Create a temp repo, stage a file with `content`, and run the hook. */
function runHookOnStaged(relPath: string, content: string): number {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-hook-"));
  try {
    git(dir, ["init", "-q"]);
    git(dir, ["config", "user.email", "t@t.t"]);
    git(dir, ["config", "user.name", "t"]);
    const full = path.join(dir, relPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, "utf-8");
    git(dir, ["add", relPath]);
    const res = spawnSync("sh", [HOOK], { cwd: dir, encoding: "utf-8" });
    return res.status ?? 1;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe("pre-commit hook (G7: core boundary is per-file)", () => {
  beforeAll(() => {
    expect(fs.existsSync(HOOK), "hook must exist").toBe(true);
  });

  it("allows a legal CLI→TUI import (not a core file)", () => {
    const code = runHookOnStaged(
      "packages/cli/src/legal.ts",
      `import { App } from "${TUI_IMPORT}";\nexport const x = App;\n`
    );
    expect(code, "a legal cli→tui import must not be blocked").toBe(0);
  });

  it("still refuses a core→tui import", () => {
    const code = runHookOnStaged(
      "packages/core/src/illegal.ts",
      `import { App } from "${TUI_IMPORT}";\nexport const x = App;\n`
    );
    expect(code, "core must never import tui").toBe(1);
  });

  it("exempts core tests, matching the gate", () => {
    const code = runHookOnStaged(
      "packages/core/src/__tests__/boundary.test.ts",
      `import { App } from "${TUI_IMPORT}";\nexport const x = App;\n`
    );
    expect(code, "core test fixtures may reference tui/cli").toBe(0);
  });

  it("still catches slop in a core file (raw error ternary)", () => {
    const code = runHookOnStaged(
      "packages/core/src/slop.ts",
      `export const m = (e: unknown) => (${RAW_TERNARY});\n`
    );
    expect(code, "raw error formatting must be refused").toBe(1);
  });
});

/**
 * Per-rule path parity. `want` is the verdict the GATE gives, transcribed from
 * its Step 1 rule set: a test path is judged by the skipped-test rule alone,
 * every other path by the rest. The old hook returned 1 for every "accept" row
 * marked (was 1) — those are the false positives this change removes — and 0
 * for every "reject" row marked (was 0) — the families it never carried.
 */
type Probe = { label: string; relPath: string; body: string; want: 0 | 1; was?: 0 | 1 };

// One unique path per case: the differential suite stages the whole corpus at
// once, so two cases sharing a path would overwrite each other and their
// verdicts would blur together.
const testFile = (slug: string): string => `packages/core/src/__tests__/${slug}.test.ts`;
const srcFile = (slug: string): string => `packages/core/src/${slug}.ts`;
const SIMPLE_CAST = `const v = (stats[0] ${AS_ANY}).count;\n`;

const PATH_PROBES: Probe[] = [
  { label: "test path + fixture cast: the gate exempts it", relPath: testFile("fixtureCast"), body: SIMPLE_CAST, want: 0, was: 1 },
  { label: "source path + the same cast: still refused", relPath: srcFile("fixtureCast"), body: SIMPLE_CAST, want: 1, was: 1 },
  { label: "test path + empty catch: the gate exempts it", relPath: testFile("emptyCatch"), body: `try { run(); } ${EMPTY_CATCH}\n`, want: 0, was: 1 },
  { label: "source path + empty catch: still refused", relPath: srcFile("emptyCatch"), body: `try { run(); } ${EMPTY_CATCH}\n`, want: 1, was: 1 },
  { label: "test path + placeholder: the gate exempts it", relPath: testFile("placeholder"), body: `// ${PLACEHOLDER}\n`, want: 0, was: 1 },
  { label: "source path + placeholder: still refused", relPath: srcFile("placeholder"), body: `// ${PLACEHOLDER}\n`, want: 1, was: 1 },
  { label: "test path + ts suppression: the gate exempts it", relPath: testFile("suppression"), body: `// ${TS_IGNORE}\nconst x = 1;\n`, want: 0, was: 1 },
  { label: "test path + skipped block: the one rule tests own", relPath: testFile("skipBlock"), body: `${SKIP_IT}("never runs", () => {});\n`, want: 1, was: 1 },
  { label: "source path naming the skip pattern: not a test, not skipped", relPath: srcFile("skipRegistry"), body: `export const REGISTRY_LABEL = "${SKIP_IT}";\n`, want: 0, was: 0 },
  { label: "a skipped block in a source path is out of the rule's scope", relPath: srcFile("skipDoc"), body: `export const doc = "${SKIP_DESCRIBE}";\n`, want: 0, was: 0 },
  { label: "bare any annotation is carried (the hook never had it)", relPath: srcFile("bareAny"), body: `const m${BARE_ANY} = {};\n`, want: 1, was: 0 },
  { label: "a non-capturing group is not a bare any", relPath: srcFile("nonCapturing"), body: `const re = ${NON_CAPTURING};\n`, want: 0, was: 0 },
  { label: "as Error casts are carried (the hook never had them)", relPath: srcFile("asError"), body: `const msg = (err ${AS_ERROR}).message;\n`, want: 1, was: 0 },
  { label: "?.message ?? String is carried, and now with the gate's spacing", relPath: srcFile("dotMessage"), body: `const msg = ${DOT_MESSAGE};\n`, want: 1, was: 1 },
  { label: "magic literals are carried (the hook never had them)", relPath: srcFile("magicLiteral"), body: `const r = fetch(url, { ${MAGIC_LITERAL} });\n`, want: 1, was: 0 },
  { label: "a named constant is clean", relPath: srcFile("namedConstant"), body: `const r = fetch(url, { timeo${"ut"}: PROVIDER_TIMEOUT_MS });\n`, want: 0, was: 0 },
  { label: "template-literal content is generated text", relPath: srcFile("templateContent"), body: `  \`${MAGIC_LITERAL}\`\n`, want: 0, was: 0 },
  { label: "a comment may name a pattern without being code", relPath: srcFile("patternComment"), body: `// this prose mentions ${AS_ANY} but is not code\n`, want: 0, was: 0 },
  { label: "a rule split across two added lines is caught", relPath: srcFile("splitRule"), body: `const x = data as\n  any;\n`, want: 1, was: 0 },
  { label: "a silent non-empty catch is caught", relPath: srcFile("silentCatch"), body: `try { run(); } ${SILENT_CATCH}\n`, want: 1, was: 0 },
  { label: "a catch that logs is compliant", relPath: srcFile("loggedCatch"), body: `try { run(); } ${LOGGED_CATCH}\n`, want: 0, was: 0 },
  { label: "a catch with a rationale comment is compliant", relPath: srcFile("explainedCatch"), body: `try { run(); } ${EXPLAINED_CATCH}\n`, want: 0, was: 0 },
  {
    label: "a multi-line silent catch is caught by the brace-aware pass",
    relPath: srcFile("multilineSilentCatch"),
    body: `try {\n  run();\n} catch (err) {\n  return null;\n}\n`,
    want: 1,
    was: 0,
  },
  {
    label: "a multi-line catch that logs is compliant",
    relPath: srcFile("multilineLoggedCatch"),
    body: `try {\n  run();\n} catch (err) {\n  log.warn(err);\n}\n`,
    want: 0,
    was: 0,
  },
  {
    label: "catch braces split across two added lines are caught",
    relPath: srcFile("splitCatch"),
    body: `try { a(); } catch (err)\n{}\n`,
    want: 1,
    was: 0,
  },
  {
    label: "instanceof-Error split across two added lines is caught",
    relPath: srcFile("splitInstanceof"),
    body: `const m = e instanceof Error\n  ? e.message : String(e);\n`,
    want: 1,
    was: 0,
  },
  { label: "hardcoded TUI color is carried", relPath: "packages/tui/src/components/Probe.tsx", body: `export const P = () => <Box ${HARDCODED_COLOR} />;\n`, want: 1, was: 0 },
  { label: "hardcoded color outside components/ is not judged", relPath: "packages/tui/src/theme/probe.ts", body: `export const P = ${HARDCODED_COLOR};\n`, want: 0, was: 0 },
  { label: "packages/cli/scripts is not a gate scan root", relPath: "packages/cli/scripts/tool.ts", body: SIMPLE_CAST, want: 0, was: 1 },
  { label: "scripts/*.cjs is in scope (the old pathspec missed it)", relPath: "scripts/tool.cjs", body: SIMPLE_CAST, want: 1, was: 0 },
  { label: "evals/tasks fixture data is excluded", relPath: "evals/tasks/01-x/setup/a.ts", body: SIMPLE_CAST, want: 0, was: 0 },
  { label: "a path outside every scan root is ignored", relPath: "docs/example.ts", body: SIMPLE_CAST, want: 0, was: 0 },
];

describe("pre-commit hook (Step 1 parity: the gate's rules, split by the gate's paths)", () => {
  for (const probe of PATH_PROBES) {
    it(probe.label, () => {
      expect(runHookOnStaged(probe.relPath, probe.body), probe.label).toBe(probe.want);
    });
  }
});

/** Everything the gate hashes or reads before it can run at all. */
const GATE_SCAFFOLD = [
  "scripts/verify-gate.mjs",
  "scripts/gate-manifest.json",
  "AGENTS.md",
  ".fresh-allowlist.json",
  "docs/PHASE-21-25-AUDIT.md",
  "packages/cli/src/__tests__/gate.sentinel.test.ts",
  ".github/workflows/ci.yml",
  ".github/workflows/live-eval.yml",
  ".github/workflows/release.yml",
  ".github/workflows/visual-regression.yml",
  ".githooks/pre-commit",
];
const SCAN_ROOT_DIRS = [
  "packages/core/src",
  "packages/core/scripts",
  "packages/tui/src",
  "packages/tui/scripts",
  "packages/cli/src",
  "scripts",
  "evals",
];

/**
 * A scratch repo the REAL gate can run inside: the gate + every artifact its
 * manifest hashes, committed as a seed so only the corpus is in the diff. The
 * scan roots exist as directories because Step 1.5 walks them.
 */
function makeGateLab(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-parity-"));
  git(dir, ["init", "-q"]);
  git(dir, ["config", "user.email", "t@t.t"]);
  git(dir, ["config", "user.name", "t"]);
  for (const rel of GATE_SCAFFOLD) {
    const dest = path.join(dir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(ROOT, rel), dest);
  }
  for (const d of SCAN_ROOT_DIRS) fs.mkdirSync(path.join(dir, d), { recursive: true });
  fs.writeFileSync(path.join(dir, "seed.txt"), "seed\n", "utf-8");
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", "seed"]);
  return dir;
}

const stageCorpus = (dir: string, probes: readonly Probe[]): void => {
  for (const p of probes) {
    const full = path.join(dir, p.relPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, p.body, "utf-8");
  }
  git(dir, ["add", "-A"]);
};

const stripAnsi = (s: string): string => s.replace(/\u001b\[[0-9;]*m/g, "");
const output = (out: string | null, err: string | null): string => `${out ?? ""}${err ?? ""}`;

/** Hook violation lines are exactly `<path>:`. */
function refusedByHook(log: string): Set<string> {
  const found = new Set<string>();
  for (const line of stripAnsi(log).split("\n")) {
    const m = /^([A-Za-z0-9_./@-]+):$/.exec(line.trim());
    if (m) found.add(m[1]);
  }
  return found;
}

/** Gate violations read `  • <path>: <detail>` (Step 1) or `  • <path>:<line> <rule>` (Step 1.5). */
function refusedByGate(log: string): Set<string> {
  const found = new Set<string>();
  for (const line of stripAnsi(log).split("\n")) {
    const m = /^\s*•\s*([^:]+):/.exec(line);
    if (m) found.add(m[1].trim());
  }
  return found;
}

/** Run the authoritative gate the way a developer would, with CI's relaxed protected-change path off. */
const runGate = (dir: string, extra: string[] = []) =>
  spawnSync(process.execPath, ["scripts/verify-gate.mjs", "--quick", "--staged", ...extra], {
    cwd: dir,
    encoding: "utf-8",
    env: { ...process.env, CI: "" },
  });

const runHook = (dir: string) => spawnSync("sh", [HOOK], { cwd: dir, encoding: "utf-8" });

describe("pre-commit hook agrees with the real gate", () => {
  it("reports the same refused set over one staged corpus, verdict by verdict", () => {
    const dir = makeGateLab();
    try {
      stageCorpus(dir, PATH_PROBES);
      const hookRes = runHook(dir);
      const gateRes = runGate(dir);
      const hookLog = output(hookRes.stdout, hookRes.stderr);
      const gateLog = output(gateRes.stdout, gateRes.stderr);

      expect(gateRes.status, `the gate must run in the lab:\n${gateLog.slice(-2000)}`).toBe(1);
      expect(hookRes.status, `the hook must refuse the corpus:\n${hookLog.slice(-2000)}`).toBe(1);

      const byHook = refusedByHook(hookLog);
      const byGate = refusedByGate(gateLog);
      for (const p of PATH_PROBES) {
        if (p.want === 1) {
          expect(byHook.has(p.relPath), `hook must refuse: ${p.label}`).toBe(true);
          expect(byGate.has(p.relPath), `gate must refuse: ${p.label}`).toBe(true);
        } else {
          expect(byHook.has(p.relPath), `hook must accept: ${p.label}`).toBe(false);
          expect(byGate.has(p.relPath), `gate must accept: ${p.label}`).toBe(false);
        }
      }
      expect([...byHook].sort(), "the two scanners must name the same files").toEqual([...byGate].sort());
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("accepts a corpus of only exempt cases, exactly as the gate does", () => {
    const dir = makeGateLab();
    try {
      stageCorpus(dir, PATH_PROBES.filter((p) => p.want === 0));
      const hookRes = runHook(dir);
      const gateRes = runGate(dir);
      const gateLog = output(gateRes.stdout, gateRes.stderr);
      expect(gateRes.status, `the gate must accept clean corpus work:\n${gateLog.slice(-2000)}`).toBe(0);
      expect(hookRes.status, `the hook must not refuse what the gate accepts:\n${output(hookRes.stdout, hookRes.stderr).slice(-2000)}`).toBe(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses a protected-artifact change on both sides, naming the same path", () => {
    const dir = makeGateLab();
    try {
      // Stage a MODIFIED protected file while the working tree still matches the
      // manifest, so this exercises the protected-change rule itself rather than
      // Step 0.5's integrity drift.
      const target = path.join(dir, ".githooks", "pre-commit");
      const original = fs.readFileSync(target, "utf-8");
      fs.writeFileSync(target, `${original}\n# tamper\n`, "utf-8");
      git(dir, ["add", ".githooks/pre-commit"]);
      fs.writeFileSync(target, original, "utf-8");

      const hookRes = runHook(dir);
      const gateRes = runGate(dir);
      const hookLog = output(hookRes.stdout, hookRes.stderr);
      const gateLog = output(gateRes.stdout, gateRes.stderr);
      expect(hookRes.status, "the hook must refuse a protected-artifact change").toBe(1);
      expect(gateRes.status, "the gate must refuse a protected-artifact change without --ack").toBe(1);
      expect(hookLog).toContain(".githooks/pre-commit");
      expect(gateLog).toContain(".githooks/pre-commit");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
