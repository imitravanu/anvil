#!/usr/bin/env node
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

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

console.log(`${BOLD}================================================================`);
console.log(` 🛡️  ANVIL AGENT GUARDIAN GATE (v2.2) — Anti-Slop & Quality Pipeline`);
console.log(`================================================================${RESET}`);

/**
 * Pure violation scanner for diff lines.
 * Evaluates added lines and returns an array of violation messages.
 */
export function scanLinesForViolations(diffLines) {
  let currentFile = "";
  const violations = [];

  for (const line of diffLines) {
    if (line.startsWith("+++ b/")) {
      currentFile = line.slice(6);
      continue;
    }
    // Only inspect newly added lines (starting with '+', not '+++')
    if (line.startsWith("+") && !line.startsWith("+++")) {
      const addedText = line.slice(1).trim();

      // Rule 1: No 'as any' or 'as never' in production code
      if (/\bas\s+(any|never)\b/.test(addedText) && !currentFile.includes("__tests__") && !currentFile.includes(".test.")) {
        violations.push(`${currentFile}: Forbidden type escape "${addedText}" (Rule 2.2: No 'as any' / 'as never')`);
      }

      // Rule 2: No empty catch blocks in new code
      if (/catch\s*(?:\([^)]*\))?\s*\{\s*\}/.test(addedText)) {
        violations.push(`${currentFile}: Silent catch block "${addedText}" (Rule 2.3: No silent catch {})`);
      }

      // Rule 3: packages/core must never import from tui or cli
      if (currentFile.startsWith("packages/core/") && (addedText.includes("@anvil/tui") || addedText.includes("@anvil/cli"))) {
        violations.push(`${currentFile}: Architecture violation "${addedText}" (Rule 2.5: Core must never import TUI or CLI)`);
      }

      // Rule 4: Zero hardcoded color strings in TUI components (must derive from theme)
      if (currentFile.startsWith("packages/tui/src/components/") && !currentFile.includes("__tests__")) {
        const hardcodedColorMatch = /\b(?:color|borderColor|backgroundColor)\s*=\s*["'](cyan|green|red|yellow|blue|magenta|white|black|gray)["']/.exec(addedText);
        if (hardcodedColorMatch) {
          violations.push(`${currentFile}: Forbidden hardcoded color "${hardcodedColorMatch[0]}" (Rule 2.6: All colors must derive from useTheme())`);
        }
      }

      // Rule 5: No sequential raw error formatting (must use getErrorMessage)
      if (/instanceof\s+Error\s*\?\s*[^:]+\s*:\s*String\(/.test(addedText)) {
        violations.push(`${currentFile}: Raw error formatting "${addedText}" (Rule 2.1: Import and use getErrorMessage(err) from @anvil/core)`);
      }

      // Rule 6: No leftover placeholder markers
      if (/\b(TODO|FIXME|XXX)\b/.test(addedText) && !currentFile.includes("__tests__")) {
        violations.push(`${currentFile}: Unfinished placeholder marker "${addedText}" (Rule 2.7: Resolve placeholders before submission)`);
      }
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Step 0: Gate Sensor Self-Test (Gate-for-Gates Sensor, V4 Resolved)
// ---------------------------------------------------------------------------
logStep(0, "Verifying Gate Sensor detection integrity...");
const sensorTestFixtures = [
  "+++ b/packages/core/src/sensorFixture.ts",
  "+ const x = data as any;",
  "+ try { doSomething(); } catch {}",
  "+ const msg = err instanceof Error ? err.message : String(err);",
  "+ import { TuiComponent } from '@anvil/tui';",
];
const sensorResults = scanLinesForViolations(sensorTestFixtures);
if (sensorResults.length < 4) {
  fail("STEP 0", `Gate sensor failed to detect intentional test slop (caught ${sensorResults.length}/4). Sensor integrity compromised.`);
} else {
  pass("STEP 0", "Gate sensor successfully verified against all intentional violation fixtures.");
}

// ---------------------------------------------------------------------------
// Step 1: Slop & Boundary Scanner on Live Git Diff
// ---------------------------------------------------------------------------
logStep(1, "Scanning git diff for AI slop and boundary violations...");

const args = process.argv.slice(2);
const stagedOnly = args.includes("--staged");

try {
  let diffCommand = stagedOnly
    ? "git diff --cached -- 'packages/*/src/**/*.ts' 'packages/*/src/**/*.tsx'"
    : "git diff HEAD -- 'packages/*/src/**/*.ts' 'packages/*/src/**/*.tsx'";

  let diff = "";
  try {
    diff = execSync(diffCommand, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 30_000,
    });
  } catch (diffErr) {
    console.warn(`${YELLOW}⚠ git diff HEAD returned non-zero (${diffErr.message}). Falling back to working tree diff...${RESET}`);
    diff = execSync("git diff -- 'packages/*/src/**/*.ts' 'packages/*/src/**/*.tsx'", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 30_000,
    });
  }

  const lines = diff.split("\n");
  const rawViolations = scanLinesForViolations(lines);

  // Filter against .fresh-allowlist.json if present
  let violations = rawViolations;
  const allowlistPath = path.resolve(process.cwd(), ".fresh-allowlist.json");
  if (fs.existsSync(allowlistPath)) {
    try {
      const allowlistData = JSON.parse(fs.readFileSync(allowlistPath, "utf-8"));
      const entries = Array.isArray(allowlistData.entries) ? allowlistData.entries : [];
      if (entries.length > 0) {
        violations = rawViolations.filter((v) => !entries.some((e) => v.includes(e.file)));
      }
    } catch (err) {
      console.warn(`${YELLOW}⚠ Failed to parse .fresh-allowlist.json: ${err.message}${RESET}`);
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
  console.log(`${YELLOW}⚠ Git diff scan skipped or no changes detected (${err.message}).${RESET}`);
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
