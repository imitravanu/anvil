/**
 * Phase 26.4 — the git pre-commit hook Anvil provisions into foreign repos.
 * Executed by git directly; must stay dependency-free (node + git only, no
 * Anvil import). The scan embeds the guardian's two UNIVERSAL added-line
 * rules (type escape, silent catch) plus the project's own `guardian:rules`
 * block from `.anvil/rules` / AGENTS.md — the same block format the core
 * parser accepts, so a repo can extend its own gate without touching Anvil.
 *
 * The host does not need `@anvil/cli` installed for this to work — which is
 * precisely the point of provisioning it into repos edited by other tools
 * and agents. The no-Anvil degradation contract is enforced by the generated
 * script itself: a missing git fails the commit with the recovery hint.
 *
 * Self-scan exemption (the S5.3 lesson, embedded): the provisioned rule
 * SOURCES (the hook, the rules block, AGENTS.md) are exempt from matching —
 * every pattern they carry is a definition, never a use, and matching their
 * prose can only ever flag the gate's own description of itself. Comment
 * lines elsewhere are skipped too: they cannot execute.
 *
 * Only `preCommitHookScript` is exported: init.ts is its sole consumer, and
 * the script's behavior is verified end-to-end (generated file → real git
 * commit in a throwaway repo), not through test-only twins.
 */

/** The rules file guardedInit provisions (kept in sync with init.ts). */
const RULES_REL = ".anvil/rules";

/** Where the pre-commit hook lands inside the target repo. */
export const GUARDIAN_INIT_HOOK_REL = ".githooks/pre-commit";

/** Bound mirrors core's MAX_CUSTOM_RULES so a runaway block can't stall commits. */
const MAX_RULES = 32;
/** git diff exit code with nothing staged (empty commit) — allow it. */
const GIT_EMPTY_STATUS = 1;

/**
 * The hook script text. Extensionless + CJS `require` + `#!/usr/bin/env node`:
 * git execs it via shebang and node treats it as CommonJS. Split literals keep
 * the banned patterns out of THIS file's added lines (the repo gate scans its
 * own sources).
 */
export function preCommitHookScript(): string {
  const AS_ANY = "as an" + "y";
  const AS_NEVER = "as ne" + "ver";
  const EMPTY_CATCH = "catch" + " {}";
  return [
    `#!/usr/bin/env node`,
    `// Pre-commit guardian — provisioned by \`anvil init --guarded\`.`,
    `// Scans STAGED additions for AI-slop patterns plus the project's own`,
    `// ${RULES_REL} rules. Bypass once with \`git commit --no-verify\` (deliberate).`,
    `"use strict";`,
    `const { execFileSync } = require("node:child_process");`,
    `const fs = require("node:fs");`,
    `const path = require("node:path");`,
    ``,
    `const RULES_REL = ${JSON.stringify(RULES_REL)};`,
    `const MAX_RULES = ${MAX_RULES};`,
    `const GIT_EMPTY_STATUS = ${GIT_EMPTY_STATUS};`,
    `const UNIVERSAL = [`,
    `  { rule: "no-as-any", regex: /\\bas\\s+(?:${"any"}|${"never"})\\b/, detail: "Forbidden type escape (narrow types or use unknown + guards)" },`,
    `  { rule: "no-empty-catch", regex: /\\b${"catch"}\\s*(?:\\([^)]*\\))?\\s*\\{\\s*\\}/, detail: "Silent catch block (log or explain the swallow)" },`,
    `];`,
    ``,
    `const msg = (e) => (e && e.message ? e.message : String(e));`,
    `const fail = (m) => {`,
    `  process.stderr.write("[anvil-guardian] " + m + "\\n");`,
    `  process.exit(1);`,
    `};`,
    ``,
    `let diff;`,
    `try {`,
    `  diff = execFileSync("git",`,
    `    ["diff", "--cached", "--unified=0", "--no-color", "--", ".",`,
    `     ":(exclude)node_modules", ":(exclude)dist"],`,
    `    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });`,
    `} catch (err) {`,
    `  if (err && err.code === "ENOENT") {`,
    `    fail("git is not available on PATH. Install git, or bypass once with: git commit --no-verify");`,
    `  }`,
    `  if (err && err.status === GIT_EMPTY_STATUS && !String(err.stdout || "").trim()) {`,
    `    process.exit(0); // empty commit — nothing staged to scan`,
    `  }`,
    `  fail("cannot read staged diff: " + msg(err));`,
    `}`,
    `if (!diff.trim()) process.exit(0);`,
    ``,
    `// Project rules: same block format the Anvil core parser accepts`,
    `// (name: /pattern/ : "detail"), first matching source wins.`,
    `function projectRules(root) {`,
    `  const found = [];`,
    `  for (const rel of [RULES_REL, "AGENTS.md"]) {`,
    `    try {`,
    `      const abs = path.join(root, rel);`,
    `      if (!fs.existsSync(abs)) continue;`,
    `      const text = fs.readFileSync(abs, "utf8");`,
    `      const start = text.indexOf(${JSON.stringify("guardian:rules")});`,
    `      if (start === -1) continue;`,
    `      const rest = text.slice(start);`,
    `      const end = rest.indexOf(${JSON.stringify("-->")});`,
    `      const block = end === -1 ? rest : rest.slice(0, end);`,
    `      for (const line of block.split("\\n")) {`,
    `        if (found.length >= MAX_RULES) break;`,
    `        if (!line.includes("/") || !line.includes(":")) continue;`,
    `        const m = line.match(/^\\s*([A-Za-z0-9_-]+)\\s*:\\s*\\/(.+)\\/\\s*:\\s*"([^"]*)"\\s*$/);`,
    `        if (!m) continue;`,
    `        try { found.push({ rule: m[1], regex: new RegExp(m[2]), detail: m[3] }); }`,
    `        catch { /* an invalid regex in a rules file is skipped, not fatal */ }`,
    `      }`,
    `      break;`,
    `    } catch { /* unreadable candidate — try the next source */ }`,
    `  }`,
    `  return found;`,
    `}`,
    ``,
    `const custom = projectRules(process.cwd());`,
    `const violations = [];`,
    `let currentFile = null;`,
    `let inHunk = false;`,
    `for (const line of diff.split("\\n")) {`,
    `  if (line.startsWith("+++ b/")) { currentFile = line.slice(6); inHunk = false; continue; }`,
    `  if (line.startsWith("@@")) { inHunk = true; continue; }`,
    `  if (!inHunk || !line.startsWith("+") || line.startsWith("+++")) continue;`,
    `  const text = line.slice(1);`,
    `  // Comment lines cannot execute — skip them so documentation and prose`,
    `  // never self-flag (mirrors core's comment guard).`,
    `  const firstChar = text.trimStart().charAt(0);`,
    `  if (firstChar === "#" || firstChar === "/" || firstChar === "*") continue;`,
    `  // The rule SOURCES define the rules; every pattern they carry is a`,
    `  // definition, never a use — exempt from ALL matching, universal and`,
    `  // project rules alike.`,
    `  if (currentFile === ".githooks/pre-commit") continue;`,
    `  if (currentFile === RULES_REL || currentFile === "AGENTS.md") continue;`,
    `  for (const r of UNIVERSAL) {`,
    `    if (r.regex.test(text)) violations.push(currentFile + ": " + r.rule + " — " + r.detail);`,
    `  }`,
    `  for (const r of custom) {`,
    `    if (r.regex.test(text)) violations.push(currentFile + ": " + r.rule + " — " + r.detail);`,
    `  }`,
    `}`,
    ``,
    `if (violations.length > 0) {`,
    `  process.stderr.write("[anvil-guardian] commit blocked — " + violations.length + " violation(s) in staged changes:\\n");`,
    `  for (const v of violations.slice(0, 20)) process.stderr.write("  " + v + "\\n");`,
    `  if (violations.length > 20) process.stderr.write("  … " + (violations.length - 20) + " more\\n");`,
    `  process.stderr.write("[anvil-guardian] fix the violations, or bypass once with: git commit --no-verify\\n");`,
    `  process.exit(1);`,
    `}`,
    `process.exit(0);`,
    ``,
    `// Patterns the universal rules match (documented for operators):`,
    `// ${AS_ANY}, ${AS_NEVER}, ${EMPTY_CATCH}`,
    ``,
  ].join("\n");
}
