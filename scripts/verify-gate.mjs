#!/usr/bin/env node
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

function logStep(step, desc) {
  console.log(`\n${CYAN}${BOLD}[GATE ${step}]${RESET} ${desc}`);
}

function fail(step, msg) {
  console.error(`\n${RED}${BOLD}✗ [GATE FAILED at ${step}]${RESET} ${msg}`);
  process.exit(1);
}

function pass(step, msg) {
  console.log(`${GREEN}✓ [GATE PASSED ${step}]${RESET} ${msg}`);
}

export const GATE_VERSION = "2.3";

const args = process.argv.slice(2);
if (args.includes("--version") || args.includes("-v") || args.includes("version")) {
  console.log(`v${GATE_VERSION}`);
  process.exit(0);
}

if (args.includes("--help") || args.includes("-h") || args.includes("help")) {
  console.log(`
Anvil Agent Guardian Gate v${GATE_VERSION}

Usage:
  node scripts/verify-gate.mjs [options]
  npm run gate [-- options]

Options:
  --version, -v, version    Print the gate version
  --help, -h, help          Print help information
  --staged                  Scan staged additions only
  --quick                   Run sensor, manifest, diff & residual checks (Steps 0-1.5)
  --ack-protected-change    Acknowledge modifications to protected gate/manifest files
`);
  process.exit(0);
}

console.log(`${BOLD}================================================================`);
console.log(` 🛡️  ANVIL AGENT GUARDIAN GATE (v${GATE_VERSION}) — Anti-Slop & Quality Pipeline`);
console.log(`================================================================${RESET}`);

/**
 * A comment line cannot execute: a built-in-rule match inside one is a false
 * positive (S5.3 — the gate flagged a doc comment that merely *described* the
 * package boundary, and prose containing ": any"). The placeholder marker is
 * deliberately exempt: a `TODO` in a comment is exactly what that rule exists
 * to catch, and the Step 0 sensor pins that behavior.
 */
const isCommentLine = (text) => /^\s*(?:\/\/|\/\*|\*)/.test(text);

// H1 (AUDIT-2026-09-30): the scanner extension. Rule 2.4 had no scanner; these
// two shapes are the objective, low-false-positive forms (values that must come
// from config/constants.ts).
//   - an inline numeric literal in a timeout/retry/cap context (a NAMED
//     constant has no digits, so it stays clean)
//   - a raw `setTimeout(fn, N)` / `setInterval(fn, N)` call with a POSITIVE N
//     (`0` is the yield-to-event-loop idiom, not an arbitrary timeout)
//   - an inline exponent BASE in a retry schedule written as one expression
//     (`Math.pow(2, attempt)` has no assignment for the two forms above to
//     anchor on — the gap constants.ts used to document as unscannable)
// A line inside a template literal (trimmed starting with a backtick) is
// generated text, not executable code, and is skipped.
const MAGIC_TIMEOUT_RE =
  /\b(?:timeout|timeoutMs|idleMs|maxWaitMs|maxBuffer|retries|maxRetries|delayMs|debounceMs|intervalMs)\s*[:=]\s*[1-9][\d_]*\b|\bset(?:Timeout|Interval)\s*\([^,]+,\s*[1-9][\d_]*\s*\)|\bMath\.pow\(\s*[0-9][\d_]*(?:\.[\d]+)?\s*,/;

// Rule 2.3, extended: a NON-empty catch is a violation when it neither surfaces
// the failure (log/console/throw/getErrorMessage, or an `error`/`problem`/`fail`
// word) nor carries any comment. A catch that does one of those is compliant.
const CATCH_SURFACES_RE = /log\.|console\.|printSystemMessage|getErrorMessage|throw\b|error|problem|fail|warn|\/\/|\/\*/i;

/** Brace-match the body after the `{` at openIdx. */
function matchBraceBody(text, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) return text.slice(openIdx + 1, i);
    }
  }
  return text.slice(openIdx + 1);
}

/**
 * Line numbers of catch blocks that swallow an error with no log and no
 * rationale (empty catches included). Pure; used by the diff scan, the residual
 * scan, and the Step 0 sensor.
 */
export function silentCatchLines(text) {
  const out = [];
  const re = /catch\s*(?:\([^)]*\))?\s*\{/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    // A comment that merely NAMES a catch (e.g. docs/explanations) is not code.
    const lineStart = text.lastIndexOf("\n", m.index) + 1;
    const lineEnd = text.indexOf("\n", m.index);
    const line = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd);
    const before = text.slice(lineStart, m.index);
    if (/^\s*(?:\/\/|\*|\/\*)/.test(line) || before.includes("//")) continue;
    const openIdx = text.indexOf("{", m.index);
    const body = matchBraceBody(text, openIdx);
    // Empty catches are the dedicated `no-empty-catch` rule's job (no double-report).
    if (body.trim() === "") continue;
    if (CATCH_SURFACES_RE.test(body)) continue;
    out.push(text.slice(0, m.index).split("\n").length);
  }
  return out;
}

/**
 * Line numbers of catch blocks with an EMPTY body. The diff rule
 * (`catch { }` on one line) and the pair rule (two consecutive added lines)
 * between them cannot see a body whose braces are three or more lines apart, so
 * the whole-tree drain is the only checkpoint that CAN see it — and before
 * 2026-10-14 it did not, because the residual scan reused the same single-line
 * regex. Brace-matched over the whole file, so any span is seen.
 *
 * A body carrying a comment is NOT empty: §2.3 accepts a rationale comment in
 * place of a statement (CATCH_SURFACES_RE), and this scan must not contradict
 * silentCatchLines about the same catch. Pure.
 */
export function emptyCatchLines(text) {
  const out = [];
  const re = /catch\s*(?:\([^)]*\))?\s*\{/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    // A comment that merely NAMES a catch is not code (same guard as above).
    const lineStart = text.lastIndexOf("\n", m.index) + 1;
    const lineEnd = text.indexOf("\n", m.index);
    const line = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd);
    const before = text.slice(lineStart, m.index);
    if (/^\s*(?:\/\/|\*|\/\*)/.test(line) || before.includes("//")) continue;
    const openIdx = text.indexOf("{", m.index);
    const body = matchBraceBody(text, openIdx);
    if (body.trim() !== "") continue; // a body with statements is not empty
    out.push(text.slice(0, m.index).split("\n").length);
  }
  return out;
}

/**
 * AUDIT-05 (2026-09-26): an allowlist entry must name a repo-relative SOURCE
 * FILE — never a directory, glob, absolute path, `..` traversal, or non-source
 * file. The old `packages/<pkg>/src/` prefix rule accepted directories and any
 * extension, and was useless in foreign repos provisioned by
 * `anvil init --guarded`, where `src/...` is the natural layout. A shared
 * module is impossible here (core is shipped TS, this file is plain .mjs that
 * runs before any build), so core's guardian/allowlist.ts ships the identical
 * predicate and a parity test in the CLI sentinel suite fails if they drift.
 */
function isValidSourceFilePath(file) {
  if (typeof file !== "string" || file.length === 0) return false;
  if (file.startsWith("/") || file.includes("\\")) return false;
  if (file.includes("..")) return false;
  if (file.includes("*")) return false;
  if (file.endsWith("/")) return false;
  if (file.split("/").includes(".") || file.split("/").includes("..")) return false;
  return /\.[cm]?[jt]sx?$/.test(file);
}

/**
 * G1 (AUDIT-2026-09-30): the single source of truth for what the scanners cover.
 * Step 1 (diff) filters git with a pathspec derived from these roots; Step 1.5
 * (residual) walks them. The two lists used to be written out separately and
 * both omitted root `scripts`, `evals`, and the per-package `scripts` trees —
 * a blind spot that hid live slop in `scripts/audit-qwen.ts` and
 * `packages/tui/scripts/visual-diff.mjs`. One constant so they cannot drift.
 */
const SCAN_ROOTS = [
  "packages/core/src",
  "packages/core/scripts",
  "packages/tui/src",
  "packages/tui/scripts",
  "packages/cli/src",
  // Root-level tooling and the eval harness are real source that ships.
  "scripts",
  "evals",
];

/**
 * Scenario data under `evals/tasks/**` (fixture RED/GREEN shape) is pinned by
 * core's `fixtureIntegrity.test.ts` and is deliberately slop-shaped in places;
 * it is not production source and must never be judged by the anti-slop scan.
 */
const SCAN_EXCLUDED_DIRS = ["evals/tasks"];

/**
 * The gate's own rule labels and sensor fixtures contain the scanned patterns
 * as DATA (rule names, `/regex/` literals, fixture strings). This is the one
 * file where a match is expected by construction, so it alone is exempt from
 * the full-tree residual scan. Step 1 is unaffected — no version of this file
 * is ever an "added line" to itself.
 */
const RESIDUAL_SELF_EXEMPT = [
  "scripts/verify-gate.mjs",
  "packages/cli/src/__tests__/gate.sentinel.test.ts",
];

/**
 * G3b (AUDIT-2026-09-30): a violation message is `${file}: detail`. Extract the
 * file so allowlist suppression can compare PATH TO PATH. The old filter used
 * `message.includes(entry.file)`, so an entry for `src/a.ts` also suppressed
 * `src/a.tsx` — silent gate weakening waiting for the first allowlist entry.
 */
function fileOfViolation(message) {
  const idx = message.indexOf(":");
  return idx === -1 ? message : message.slice(0, idx);
}

/**
 * G3c (AUDIT-2026-09-30): protected-path detection. Exact match for the
 * enumerated artifacts, PLUS a directory-prefix rule for `.github/workflows/`,
 * because the hash manifest can only enumerate the workflow files that exist —
 * today a newly added workflow escapes both hashing and tamper detection.
 * (PROTECTED_PATHS is defined below; this only runs after it.)
 */
function isProtectedPath(relPath) {
  return PROTECTED_PATHS.some((p) => relPath === p) || relPath.startsWith(".github/workflows/");
}

/**
 * Pure violation scanner for diff lines.
 * Evaluates added lines and returns an array of violation messages.
 */
export function scanLinesForViolations(diffLines) {
  let currentFile = "";
  const violations = [];
  // Per-file added text, for the brace-aware non-empty-silent-catch pass.
  const perFileAdded = new Map();

  for (const line of diffLines) {
    if (line.startsWith("+++ b/")) {
      currentFile = line.slice(6);
      continue;
    }
    // Only inspect newly added lines (starting with '+', not '+++')
    if (line.startsWith("+") && !line.startsWith("+++")) {
      if (
        currentFile === "scripts/verify-gate.mjs" ||
        currentFile === "packages/cli/src/__tests__/gate.sentinel.test.ts"
      ) {
        continue;
      }
      const isTestFile = currentFile.includes("__tests__") || currentFile.includes(".test.");
      const addedText = line.slice(1).trim();

      // Rule for test files: No test skipping in test suites (Rule 2.10)
      if (isTestFile) {
        if (/\b(it|test|describe)\.skip\b|\b(xit|xtest|xdescribe)\s*\(/.test(addedText)) {
          violations.push(`${currentFile}: Forbidden test skipping "${addedText}" (Rule 2.10: No it.skip/test.skip/xit in tests)`);
        }
        continue;
      }

      const comment = isCommentLine(addedText);
      perFileAdded.set(currentFile, (perFileAdded.get(currentFile) ?? "") + line.slice(1) + "\n");

      // Rule 0: No @ts-ignore or @ts-nocheck in production code (regardless of comment status)
      if (/@ts-(ignore|nocheck)\b/.test(addedText)) {
        violations.push(`${currentFile}: Forbidden TypeScript suppression "${addedText}" (Rule 2.9: No @ts-ignore or @ts-nocheck in production code)`);
      }

      // Rule 1: No 'as any' or 'as never' in production code
      if (!comment && /\bas\s+(any|never)\b/.test(addedText)) {
        violations.push(`${currentFile}: Forbidden type escape "${addedText}" (Rule 2.2: No 'as any' / 'as never')`);
      }

      // Rule 1b: No bare `any` type annotations. Annotations (`: any`),
      // generics (`<any>`/`Foo<any,`), and `any[]` evade the cast-only rule
      // above — exactly how such sites slipped past review. Same test-file
      // exemption (mock fixtures).
      // The (`(?<!\?)`) guard keeps `(?:any` non-capturing groups from
      // reading as a `: any` annotation.
      if (!comment && /((?<!\?):\s*any\b|<\s*any\b|,\s*any\b|\bany\s*\[\])/.test(addedText)) {
        violations.push(`${currentFile}: Bare any type annotation "${addedText}" (Rule 2.2: use unknown + narrowing)`);
      }

      // Rule 1c: raw `as Error` narrowing (H1). Use instanceof / getErrorMessage.
      if (!comment && /\bas\s+Error\b/.test(addedText)) {
        violations.push(`${currentFile}: Forbidden 'as Error' cast "${addedText}" (Rule 2.1: use getErrorMessage(err) or a type guard)`);
      }

      // Rule 2: No empty catch blocks in new code
      if (!comment && /catch\s*(?:\([^)]*\))?\s*\{\s*\}/.test(addedText)) {
        violations.push(`${currentFile}: Silent catch block "${addedText}" (Rule 2.3: No silent catch {})`);
      }

      // Rule 7 (H1): no inline magic timeout/retry/cap literals (Rule 2.4). A
      // line that is template-literal content (starts with a backtick) is
      // generated text, not code — skipped like the residual scan does.
      if (!comment && !/^[`'"]/.test(addedText) && MAGIC_TIMEOUT_RE.test(addedText)) {
        violations.push(`${currentFile}: Hardcoded magic constant "${addedText}" (Rule 2.4: import from @anvil/core constants)`);
      }

      // Rule 3: packages/core must never import from tui or cli
      if (!comment && currentFile.startsWith("packages/core/") && (addedText.includes("@anvil/tui") || addedText.includes("@anvil/cli"))) {
        violations.push(`${currentFile}: Architecture violation "${addedText}" (Rule 2.5: Core must never import TUI or CLI)`);
      }

      // Rule 4: Zero hardcoded color strings in TUI components (must derive from theme)
      if (!comment && currentFile.startsWith("packages/tui/src/components/")) {
        const hardcodedColorMatch = /\b(?:color|borderColor|backgroundColor)\s*=\s*(?:\{[ \t]*[`](cyan|green|red|yellow|blue|magenta|white|black|gray)[`][ \t]*\}|["'](cyan|green|red|yellow|blue|magenta|white|black|gray)["']|[`](cyan|green|red|yellow|blue|magenta|white|black|gray)[`])/.exec(addedText);
        if (hardcodedColorMatch) {
          violations.push(`${currentFile}: Forbidden hardcoded color "${hardcodedColorMatch[0]}" (Rule 2.6: All colors must derive from useTheme())`);
        }
      }

      // Rule 5: No sequential raw error formatting (must use getErrorMessage)
      // 5a: ternary with String() fallback. 5b: ternary with ANY fallback
      // (e.g. JSON.stringify) — still slop, use getErrorMessage. 5c: optional-
      // chaining fallback form (also covered by residual drain 1.5).
      if (!comment && /instanceof\s+Error\s*\?/.test(addedText)) {
        violations.push(`${currentFile}: Raw error formatting "${addedText}" (Rule 2.1: Import and use getErrorMessage(err) from @anvil/core)`);
      } else if (!comment && /\.\s*message\s*\?\?\s*String\s*\(/.test(addedText)) {
        violations.push(`${currentFile}: Raw error formatting "${addedText}" (Rule 2.1: Import and use getErrorMessage(err) from @anvil/core)`);
      }

      // Rule 6: No leftover placeholder markers
      if (/\b(TODO|FIXME|XXX)\b/.test(addedText)) {
        violations.push(`${currentFile}: Unfinished placeholder marker "${addedText}" (Rule 2.7: Resolve placeholders before submission)`);
      }
    }
  }

  // Non-empty silent catches: brace-aware pass over each file's added text.
  // Only `+` lines of NON-test files reach perFileAdded (tests continue above).
  for (const [file, text] of perFileAdded) {
    if (silentCatchLines(text).length > 0) {
      violations.push(`${file}: Silent catch block with no log or rationale (Rule 2.3: log, or add // intentional: <reason>)`);
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Step 0: Gate Sensor Self-Test (Gate-for-Gates Sensor, V4 Resolved)
// ---------------------------------------------------------------------------
logStep(0, "Verifying Gate Sensor detection integrity...");
// G2 (AUDIT-2026-09-30): the sensor used 9 fixtures with a `< 8` threshold, so
// deleting ANY ONE rule family still passed. It is now a probe table where each
// entry names the family it must trip; the gate fails per-probe by IDENTITY, so
// a neutered rule (`if (false)`) fails the probe that exists to catch it. A
// TUI-color probe is added (the rule had no coverage at all).
const SENSOR_PROBES = [
  { label: "as-any cast", line: "+ const x = data as any;" },
  { label: "as-never cast", line: "+ const y = data as never;" },
  { label: "empty catch", line: "+ try { doSomething(); } catch {}" },
  { label: "raw error (String fallback)", line: "+ const msg = err instanceof Error ? err.message : String(err);" },
  { label: "raw error (JSON fallback)", line: "+ const msg2 = err instanceof Error ? err.message : JSON.stringify(err);" },
  { label: "raw error (?.message ?? String)", line: "+ const msg3 = e.message ?? String(e);" },
  { label: "core imports tui", line: "+ import { TuiComponent } from '@anvil/tui';" },
  { label: "bare any annotation", line: "+ const z: any = 1;" },
  { label: "comma-position any (G3a)", line: "+ const m: Record<string, any> = {};" },
  { label: "hardcoded TUI color", line: "+ <Box color=\"cyan\" />", file: "packages/tui/src/components/SensorProbe.tsx" },
  { label: "ts-ignore suppression", line: "+ // @ts-ignore" },
  { label: "ts-nocheck suppression", line: "+ // @ts-nocheck" },
  { label: "skipped test probe", line: "+ it.skip(\"fails\", () => {});", file: "packages/core/src/__tests__/sensor.test.ts" },
  { label: "as Error cast (H1)", line: "+ const msg = (err as Error).message;" },
  { label: "magic timeout literal (H1)", line: "+ const r = fetch(url, { timeout: 5000 });" },
  { label: "silent non-empty catch (H1)", line: "+ try { a(); } catch { b = 1; }" },
];
const sensorMisses = SENSOR_PROBES.filter(
  (probe) => scanLinesForViolations([`+++ b/${probe.file ?? "packages/core/src/sensorFixture.ts"}`, probe.line]).length === 0
);
if (sensorMisses.length > 0) {
  fail(
    "STEP 0",
    `Gate sensor failed to detect intentional slop probes: ${sensorMisses.map((p) => p.label).join(", ")} ` +
      `(${SENSOR_PROBES.length - sensorMisses.length}/${SENSOR_PROBES.length} caught). Sensor integrity compromised.`
  );
} else {
  pass("STEP 0", `Gate sensor verified ${SENSOR_PROBES.length}/${SENSOR_PROBES.length} intentional violation probes by family.`);
}

// ---------------------------------------------------------------------------
// Step 0.5: Protected-Artifact Integrity Manifest
// ---------------------------------------------------------------------------
logStep("0.5", "Verifying Gate, Constitution & Sentinel integrity against committed manifest...");
const PROTECTED_PATHS = [
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
{
  let manifest = {};
  try {
    manifest = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "scripts/gate-manifest.json"), "utf-8"));
  } catch (manifestErr) {
    fail("STEP 0.5", `scripts/gate-manifest.json missing or unreadable: ${manifestErr.message}`);
  }
  const hashes = manifest && typeof manifest === "object" && manifest.hashes ? manifest.hashes : {};
  // The manifest cannot hash itself (writing its own hash changes its content).
  // Its integrity is covered by the sentinel test + tamper detection + review.
  for (const rel of PROTECTED_PATHS) {
    if (rel === "scripts/gate-manifest.json") continue;
    let content = "";
    try {
      content = fs.readFileSync(path.resolve(process.cwd(), rel), "utf-8");
    } catch (readErr) {
      fail("STEP 0.5", `Protected artifact missing: ${rel} (${readErr.message})`);
    }
    const h = crypto.createHash("sha256").update(content).digest("hex");
    if (hashes[rel] !== h) {
      fail(
        "STEP 0.5",
        `Integrity mismatch for ${rel}. Live=${h} manifest=${hashes[rel] ?? "<missing>"}. ` +
          `Protected artifacts may only change together with an explicit manifest + sentinel update and human review.`
      );
    }
  }
  pass("STEP 0.5", "Gate, constitution, allowlist, audit, sentinel, and CI hashes verified against manifest.");
}

// ---------------------------------------------------------------------------
// Step 1: Slop & Boundary Scanner on Live Git Diff
// ---------------------------------------------------------------------------
logStep(1, "Scanning git diff for AI slop and boundary violations...");

const stagedOnly = args.includes("--staged");

try {
  // G1: derive the diff pathspec from the same SCAN_ROOTS the residual walk
  // uses, so the two scanners can never disagree about coverage. `evals/tasks`
  // is excluded here for the same reason Step 1.5 excludes it (scenario data).
  // `:(glob)` magic is required: without it git's fnmatch treats `**/` as "at
  // least one directory", so a file directly under a root (e.g. src/x.ts) is
  // silently missed.
  //
  // 2026-10-10 (takeover): jsx/mts/cts join the list — Step 1.5's
  // `/\.[cm]?[jt]sx?$/` always covered them, so a brand-new .jsx file escaped
  // Step 1 entirely. Double quotes, not single (the same G12 reason the CLI
  // gate switched): single quotes are not quoting under cmd.exe, and this
  // command runs through a shell on every platform.
  const SCAN_EXTS = ["ts", "tsx", "js", "jsx", "mjs", "cjs", "mts", "cts"];
  const PATHSPEC = [
    ...SCAN_ROOTS.flatMap((root) => SCAN_EXTS.map((ext) => `":(glob)${root}/**/*.${ext}"`)),
    ...SCAN_EXCLUDED_DIRS.map((dir) => `":(glob,exclude)${dir}/**"`),
  ].join(" ");
  const ciMode = process.env.CI === "true";
  const ackProtected = args.includes("--ack-protected-change");

  // CI-aware diff base: in a clean checkout `git diff HEAD` is empty, which would
  // make Step 1 a silent no-op in CI. On PRs diff against the base ref; on push,
  // against the previous commit.
  let base = "HEAD";
  if (ciMode) {
    if (process.env.GITHUB_BASE_REF) {
      base = `origin/${process.env.GITHUB_BASE_REF}...HEAD`;
    } else {
      // Push path: HEAD~1 blinds multi-commit pushes for Step-1-only families
      // (as-any, TODO, arch have no other checkpoint until residual covers them;
      // now residual does, but keep the diff wide anyway). Prefer merge-base.
      let mb = "";
      for (const ref of ["origin/master", "origin/main"]) {
        try {
          mb = execSync(`git merge-base ${ref} HEAD`, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"], timeout: 15_000 }).trim();
          if (mb) { base = `${mb}...HEAD`; break; }
        } catch {
          // intentional: ref may not exist in this clone, try next
        }
      }
      if (!mb) base = "HEAD~1";
    }
  }

  let diff = "";
  try {
    diff = stagedOnly
      ? execSync(`git diff --cached -- ${PATHSPEC}`, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"], timeout: 30_000 })
      : execSync(`git diff ${base} -- ${PATHSPEC}`, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"], timeout: 30_000 });
  } catch (diffErr) {
    if (stagedOnly) throw diffErr;
    console.warn(`${YELLOW}⚠ git diff ${base} returned non-zero (${diffErr.message}). Falling back to working-tree diff...${RESET}`);
    diff = execSync(`git diff -- ${PATHSPEC}`, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"], timeout: 30_000 });
  }

  // Untracked files are invisible to `git diff` — without this a brand-new
  // source file full of slop would ship on its first commit unscanned.
  // The STAGED surface deliberately does NOT inherit the pass (2026-10-10):
  // `--staged` judges exactly what a commit would ship (the index), and an
  // untracked file is not in it. The product gate (packages/cli gate.ts,
  // Batch P) made the same call; the two authorities now agree instead of
  // contradicting each other.
  if (!stagedOnly) {
    try {
      const untracked = execSync(`git ls-files --others --exclude-standard -- ${PATHSPEC}`, {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 30_000,
      });
      if (untracked.trim()) {
        const parts = [diff.trim()];
        for (const file of untracked.trim().split(/\r?\n/)) {
          const rel = file.trim();
          if (!rel) continue;
          const content = fs.readFileSync(rel, "utf-8");
          parts.push(`+++ b/${rel}`);
          for (const ln of content.split(/\r?\n/)) parts.push(`+ ${ln}`);
        }
        diff = parts.join("\n");
      }
    } catch (untrackedErr) {
      console.warn(`${YELLOW}⚠ Could not scan untracked sources (${untrackedErr.message}).${RESET}`);
    }
  }

  const lines = diff.split("\n");
  const rawViolations = scanLinesForViolations(lines);

  // Multiline second pass: per-line scanning misses tokens split across lines
  // (e.g. `data as` +\n + `any;`, `catch (e)` +\n + `{}`, `instanceof` +\n +
  // `Error ?`). Mirror the in-process guardian's pair scan: judge consecutive
  // ADDED lines, and skip a pair that touches a comment. Comments cannot be a
  // real split violation, and a comment INSIDE a catch is the §2.3 rationale
  // that makes the catch intentional — so a pair-based comment skip fixes both
  // the `// ... as` / `any` false positive and the `catch { // intentional }`
  // false positive without weakening the rules.
  {
    let cur = "";
    const perFileLines = new Map();
    for (const line of lines) {
      if (line.startsWith("+++ b/")) { cur = line.slice(6); continue; }
      if (line.startsWith("+") && !line.startsWith("+++")) {
        if (!perFileLines.has(cur)) perFileLines.set(cur, []);
        perFileLines.get(cur).push(line.slice(1));
      }
    }
    const multi = [
      { re: /\bas\s*\n\s*(any|never)\b/, label: `Forbidden type escape split across lines (Rule 2.2: No 'as any' / 'as never')` },
      { re: /catch\s*(?:\([^)]*\))?\s*\{[ \t\r\n]*\}/, label: `Silent catch block split across lines (Rule 2.3: No silent catch {})` },
      { re: /instanceof\s*\n\s*Error\s*\?|instanceof\s+Error\s*\n\s*\?/, label: `Raw error formatting split across lines (Rule 2.1: use getErrorMessage(err))` },
    ];
    for (const [file, fileLines] of perFileLines) {
      if (file.includes("__tests__") || file.includes(".test.") || file === "scripts/verify-gate.mjs") continue;
      if (rawViolations.some((v) => v.startsWith(file + ":"))) continue;
      for (let i = 0; i < fileLines.length - 1; i++) {
        if (isCommentLine(fileLines[i].trim()) || isCommentLine(fileLines[i + 1].trim())) continue;
        const joined = fileLines[i] + "\n" + fileLines[i + 1];
        for (const { re, label } of multi) {
          if (re.test(joined)) {
            rawViolations.push(`${file}: ${label}`);
            break;
          }
        }
      }
    }
  }

  // Filter against .fresh-allowlist.json if present. The allowlist is data the
  // gate trusts — validate its shape BEFORE applying it. A broad entry such as
  // "packages" would otherwise suppress every violation (silent gate weakening),
  // and a malformed allowlist must FAIL, not be silently ignored.
  let violations = rawViolations;
  const allowlistPath = path.resolve(process.cwd(), ".fresh-allowlist.json");
  if (fs.existsSync(allowlistPath)) {
    let allowlistData = {};
    try {
      allowlistData = JSON.parse(fs.readFileSync(allowlistPath, "utf-8"));
    } catch (parseErr) {
      fail("STEP 1", `Failed to parse .fresh-allowlist.json: ${parseErr.message}`);
    }
    const entries = Array.isArray(allowlistData.entries) ? allowlistData.entries : [];
    for (const entry of entries) {
      if (typeof entry !== "object" || entry === null) {
        fail("STEP 1", `Malformed allowlist entry (must be an object): ${JSON.stringify(entry)}`);
      }
      if (!isValidSourceFilePath(entry.file)) {
        fail("STEP 1", `Rejected allowlist entry (must be a repo-relative source file path, e.g. packages/<pkg>/src/x.ts or src/x.ts — no directories, globs, absolute paths, or traversal): ${JSON.stringify(entry.file)}`);
      }
      if (typeof entry.reason !== "string" || entry.reason.trim().length < 4) {
        fail("STEP 1", `Allowlist entry for ${entry.file} requires a real reason (>=4 chars).`);
      }
    }
    if (entries.length > 0) {
      // G3b: match the violation's FILE PATH exactly (path-to-path), never a
      // substring of the whole message. A path-only comparison also means a
      // legitimate `src/a.ts` entry can no longer suppress `src/a.tsx`.
      violations = rawViolations.filter(
        (v) => !entries.some((e) => fileOfViolation(v) === e.file)
      );
    }
  }

  // Protected-artifact tamper detection: any change to the gate, manifest,
  // constitution, allowlist, sentinel, audit, or CI workflows requires an
  // explicit human-acknowledged review. Locally the gate REFUSES to pass such
  // a change without --ack-protected-change; in CI, pull-request review is the
  // gate (the warning still prints as evidence).
  {
    const stagedArg = stagedOnly ? "--cached " : "";
    let nameOnly = "";
    try {
      nameOnly = execSync(`git diff --name-only ${stagedArg}${ciMode ? base : "HEAD"}`, {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 30_000,
      });
    } catch (nameErr) {
      // intentional: porcelain status fallback below still runs
    }
    let porcelain = "";
    // In --staged (pre-commit) mode, judge ONLY what is being committed: the
    // unstaged working tree is not part of the commit and is the full gate's
    // jurisdiction. Otherwise union both views (belts and suspenders).
    if (!stagedOnly) {
      try {
        porcelain = execSync("git status --porcelain", { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"], timeout: 15_000 });
      } catch (statusErr) {
        // intentional: read-only/CI environments may not expose status
      }
    }
    const touched = [...new Set(
      (nameOnly + "\n" + porcelain)
        .split(/\r?\n/)
        // Strip the porcelain status prefix (" M ", "?? ", etc.) before matching
        // so tracked/untracked views of the same file don't double-report.
        .map((l) => l.replace(/^[ MADRCU?!]{1,2}\s+/, ""))
        .filter((l) => l && isProtectedPath(l))
    )];
    if (touched.length > 0) {
      console.warn(`\n${BOLD}${RED}🔴 PROTECTED ARTIFACT CHANGE DETECTED:${RESET} ${touched.join(", ")}`);
      console.warn(`${BOLD}The gate, manifest, constitution, allowlist, sentinel test, audit, and CI scripts${RESET}`);
      console.warn(`${BOLD}require human review. Locally, pass --ack-protected-change to confirm the review.${RESET}`);
      if (!ciMode && !ackProtected) {
        fail("STEP 1", "Refusing a protected-artifact change without --ack-protected-change (human-acknowledged review).");
      }
    }
  }

  if (violations.length > 0) {
    console.error(`\n${RED}${BOLD}AI Slop Violations Detected in Diff:${RESET}`);
    for (const v of violations) {
      console.error(`  ${RED}• ${v}${RESET}`);
    }
    fail("STEP 1", "Clean up all AI slop patterns before submitting your work.");
  } else {
    pass("STEP 1", "Zero new slop patterns detected in git diff.");
  }
} catch (err) {
  if (err.message && err.message.includes("GATE FAILED")) throw err;
  fail("STEP 1", `Diff scan errored and could not be completed (scan bypass is not allowed): ${err.message}`);
}

// ---------------------------------------------------------------------------
// Step 1.5: Residual Slop Drain Scan (full-file, allowlist-free)
// ---------------------------------------------------------------------------
// The diff scanner above only sees ADDED lines. Legacy violations in already-
// committed files stay invisible forever — and every agent that patches near
// them copies the pattern again (the "slop that keeps regenerating" problem).
// This step scans the FULL tree for the drainable families and FAILS on any
// hit, so the debt only shrinks (migrate once → gate stays green forever).
logStep("1.5", "Scanning FULL source files for legacy slop the diff scanner cannot see...");

const RESIDUAL_RULES = [
  { name: "raw error formatting (instanceof ternary, any fallback)", re: /instanceof\s+Error\s*\?/ },
  { name: "raw error formatting (?.message ?? String)", re: /\.message\s*\?\?\s*String\(/ },
  { name: "core self-import (@anvil/core inside packages/core)", re: /from\s+["']@anvil\/core["']/, onlyCore: true },
  { name: "core boundary breach (imports tui/cli)", re: /@anvil\/(tui|cli)/, onlyCore: true },
  { name: "type escape (as any/never)", re: /\bas\s+(any|never)\b/ },
  { name: "type escape (bare any annotation)", re: /((?<!\?):\s*any\b|<\s*any\b|,\s*any\b|\bany\s*\[\])/ },
  { name: "placeholder marker (TODO/FIXME/XXX)", re: /\b(TODO|FIXME|XXX)\b/ },
  // "empty catch block" is deliberately NOT a per-line rule here: a per-line
  // regex can only match a one-line `catch {}`, so routing the whole-tree drain
  // through it left a multi-line empty catch invisible forever (2026-10-14).
  // Step 1.5 uses the brace-aware emptyCatchLines() pass below instead, which
  // matches every shape the per-line rule matched AND every shape it could not.
  { name: "hardcoded color in TUI components", re: /\b(?:color|borderColor|backgroundColor)\s*=\s*(?:\{[ \t]*[`](?:cyan|green|red|yellow|blue|magenta|white|black|gray)[`][ \t]*\}|["'](?:cyan|green|red|yellow|blue|magenta|white|black|gray)["']|[`](?:cyan|green|red|yellow|blue|magenta|white|black|gray)[`])/, onlyTuiComponents: true },
  { name: "TypeScript suppression (@ts-ignore/@ts-nocheck)", re: /@ts-(ignore|nocheck)\b/ },
  { name: "skipped test (it.skip/test.skip/xit)", re: /\b(it|test|describe)\.skip\b|\b(xit|xtest|xdescribe)\s*\(/, onlyTests: true },
  // H1: Rule 2.4 had no scanner. Inline timeout/retry/cap literals and raw
  // `as Error` casts are now drained full-tree (template-literal content lines
  // — trimmed starting with a backtick — are generated text, not code).
  { name: "magic timeout/retry/cap literal (Rule 2.4)", re: MAGIC_TIMEOUT_RE, skipTemplate: true },
  { name: "'as Error' cast (Rule 2.1)", re: /\bas\s+Error\b/ },
];

function walkSourceFiles(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      walkSourceFiles(full, out);
    } else if (entry.isFile() && /\.[cm]?[jt]sx?$/.test(entry.name)) {
      out.push(full);
    }
  }
}
{
  const files = [];
  for (const d of SCAN_ROOTS) walkSourceFiles(path.resolve(process.cwd(), d), files);
  const hits = [];
  for (const file of files) {
    const rel = path.relative(process.cwd(), file);
    if (rel.includes("/dist/")) continue;
    // G1: fixture scenario data and the gate's own rule-data are not judged.
    if (SCAN_EXCLUDED_DIRS.some((ex) => rel.startsWith(ex))) continue;
    if (RESIDUAL_SELF_EXEMPT.includes(rel)) continue;
    const isCore = rel.startsWith("packages/core/");
    const isTuiComponent = rel.startsWith("packages/tui/src/components/");
    const isTestFile = rel.includes("__tests__") || rel.includes(".test.");
    const content = fs.readFileSync(file, "utf-8");
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const lineIsComment = isCommentLine(lines[i]);
      for (const rule of RESIDUAL_RULES) {
        if (rule.onlyTests && !isTestFile) continue;
        if (!rule.onlyTests && isTestFile) continue;
        if (rule.onlyCore && !isCore) continue;
        if (rule.onlyTuiComponents && !isTuiComponent) continue;
        // Comments are not code (S5.3) — except for placeholder marker and ts-ignore/nocheck
        if (lineIsComment && rule.name !== "placeholder marker (TODO/FIXME/XXX)" && !rule.name.startsWith("TypeScript suppression")) continue;
        if (rule.skipTemplate && /^[`'"]/.test(lines[i].trim())) continue;
        if (rule.re.test(lines[i])) {
          hits.push(`${rel}:${i + 1} ${rule.name}`);
        }
      }
    }
    // H1: non-empty silent catches, brace-aware (whole file, non-test only).
    if (!isTestFile) {
      for (const lineNo of silentCatchLines(lines.join("\n"))) {
        hits.push(`${rel}:${lineNo} silent catch block with no log or rationale (Rule 2.3)`);
      }
      // F5 (2026-10-14): EMPTY catches, brace-aware. The per-line rule this
      // replaces could not see `catch {` and its closing brace on separate
      // lines, so such a catch passed the "debt can only shrink" drain forever.
      for (const lineNo of emptyCatchLines(content)) {
        hits.push(`${rel}:${lineNo} empty catch block (Rule 2.3)`);
      }
    }
  }
  if (hits.length > 0) {
    console.error(`\n${RED}${BOLD}Residual Slop (legacy debt that keeps regenerating):${RESET}`);
    for (const h of hits.slice(0, 30)) console.error(`  ${RED}• ${h}${RESET}`);
    if (hits.length > 30) console.error(`  ${RED}• … ${hits.length - 30} more${RESET}`);
    fail(
      "STEP 1.5",
      `Full-tree residual scan found ${hits.length} legacy violations. Migrate them ONCE so agents stop re-copying the pattern (see docs/PHASE-21-25-AUDIT.md).`
    );
  } else {
    pass("STEP 1.5", "Full-tree residual scan clean — zero legacy slop in scripts/, evals/, and packages/** (excl. tests, fixtures, gate self).");
  }
}

// Quick mode (used by the versioned pre-commit hook): Steps 0–1.5 are the
// integrity core and complete in seconds. Build/typecheck/test/eval remain
// CI's job (`npm run gate` without --quick runs everything).
const quickMode = process.argv.includes("--quick");
if (quickMode) {
  pass("QUICK", "Pre-commit quick gate complete (integrity + slop stages; build/test/eval run in CI).");
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Step 2: Monorepo Sequential Build Gate
// ---------------------------------------------------------------------------
logStep(2, "Verifying Monorepo Build (Order: core ➔ tui ➔ cli)...");
try {
  execSync("npm run build", { stdio: "inherit", timeout: 180_000 });
  pass("STEP 2", "Core, TUI, and CLI built cleanly in sequential order.");
} catch (err) {
  fail("STEP 2", `Build failed or timed out (180s): ${err.message}`);
}

// ---------------------------------------------------------------------------
// Step 3: Monorepo Typecheck Gate
// ---------------------------------------------------------------------------
logStep(3, "Running TypeScript typecheck across all workspaces...");
try {
  execSync("npm run typecheck", { stdio: "inherit", timeout: 120_000 });
  pass("STEP 3", "Zero TypeScript type errors across all workspaces.");
} catch (err) {
  fail("STEP 3", `Typecheck failed or timed out (120s): ${err.message}`);
}

// ---------------------------------------------------------------------------
// Step 4: Unit Test Suite Gate
// ---------------------------------------------------------------------------
logStep(4, "Executing test suite (Vitest across all workspaces)...");
try {
  execSync("npm test", { stdio: "inherit", timeout: 180_000 });
  pass("STEP 4", "All unit tests passed.");
} catch (err) {
  fail("STEP 4", `Unit tests failed or timed out (180s): ${err.message}`);
}

// ---------------------------------------------------------------------------
// Step 5: Fast Eval Benchmark Smoke Gate
// ---------------------------------------------------------------------------
logStep(5, "Running Eval harness mock benchmarks...");
try {
  execSync("npm run eval -- --fast --mock", { stdio: "inherit", timeout: 180_000 });
  pass("STEP 5", "Evaluation mock benchmarks passed.");
} catch (err) {
  fail("STEP 5", `Eval benchmark failed or timed out (180s): ${err.message}`);
}

console.log(`\n${GREEN}${BOLD}================================================================`);
console.log(` 🎉  GUARDIAN GATE PASSED! All quality, anti-slop, and test gates satisfied.`);
console.log(`================================================================${RESET}\n`);
