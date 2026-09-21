import fs from "node:fs";
import path from "node:path";
import { getErrorMessage } from "../errors.js";
import { preCommitHookScript, GUARDIAN_INIT_HOOK_REL } from "./hook.js";
import { languageRulesBlock, languageAdvice } from "./langRules.js";

export interface GuardedInitResult {
  created: string[];
  skipped: string[];
}

/** Where the machine-enforceable rules block is provisioned (26.4). */
export const GUARDIAN_INIT_RULES_REL = ".anvil/rules";

/** The `core.hooksPath` value guarded init sets (26.4). */
export const GUARDIAN_INIT_HOOKS_PATH = ".githooks";

/**
 * Phase 26.4 — `anvil init --guarded` provisioning for foreign agents.
 * Writes a language-tailored AGENTS.md, a starter machine-enforceable rules
 * block, and a git pre-commit hook that enforces those rules at commit time.
 * Existing files are never overwritten; an existing `.git/config` hooksPath is
 * left untouched and reported in `skipped`.
 */
export function guardedInit(targetDir: string, language: string = "typescript"): GuardedInitResult {
  const created: string[] = [];
  const skipped: string[] = [];
  const writeOnce = (rel: string, content: string, mode: number): void => {
    const abs = path.join(targetDir, rel);
    try {
      if (fs.existsSync(abs)) {
        skipped.push(rel);
        return;
      }
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content, { encoding: "utf8", mode });
      created.push(rel);
    } catch (err: unknown) {
      throw new Error(`guarded init failed for ${rel}: ${getErrorMessage(err)}`);
    }
  };

  writeOnce("AGENTS.md", guardedAgentsMd(language), 0o644);
  writeOnce(GUARDIAN_INIT_RULES_REL, languageRulesBlock(language), 0o644);
  writeOnce(".fresh-allowlist.json", "{\n  \"version\": 1,\n  \"entries\": []\n}\n", 0o644);
  // 0755: git execs the hook via its shebang; a non-executable hook is a
  // silent no-op that looks like protection and enforces nothing.
  writeOnce(GUARDIAN_INIT_HOOK_REL, preCommitHookScript(), 0o755);

  if (fs.existsSync(path.join(targetDir, ".git"))) {
    try {
      const configPath = path.join(targetDir, ".git", "config");
      const existing = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf8") : "";
      if (existing.includes("hooksPath")) {
        skipped.push("core.hooksPath (already configured)");
      } else {
        // Appending a second [core] section is valid git-config semantics and
        // preserves the repo's existing settings byte-for-byte.
        const prefix = existing.length === 0 || existing.endsWith("\n") ? "" : "\n";
        fs.appendFileSync(
          configPath,
          `${prefix}[core]\n\thooksPath = ${GUARDIAN_INIT_HOOKS_PATH}\n`
        );
        created.push("core.hooksPath (git config)");
      }
    } catch (err: unknown) {
      // A repo with an unreadable config still gets its files — the operator
      // can run `git config core.hooksPath .githooks` by hand.
      process.stderr.write(
        `anvil init: could not configure git hooksPath automatically: ${getErrorMessage(err)}\n`
      );
    }
  }

  return { created, skipped };
}

function guardedAgentsMd(language: string): string {
  return `# AGENTS.md (guarded by Anvil)

> Language: ${language}. Follow these rules on every change.

## Rules

1. ${languageAdvice(language)}
2. Keep functions small and tested; run the project's checks before finishing.

## Guardian

Commits in this repo are scanned by a pre-commit hook (provisioned by Anvil;
machine rules live in ${GUARDIAN_INIT_RULES_REL}). If a commit is blocked, fix
the reported violations, or bypass once with \`git commit --no-verify\`
(deliberate, visible escape hatch).
`;
}
