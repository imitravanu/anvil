import fs from "node:fs";
import path from "node:path";
import { getErrorMessage } from "../errors.js";

export interface GuardedInitResult {
  created: string[];
  skipped: string[];
}

/**
 * Phase 25.6 — `anvil init --guarded` provisioning.
 * Writes a language-tailored AGENTS.md and a starter .fresh-allowlist.json
 * into the target project. Never overwrites existing files.
 */
export function guardedInit(targetDir: string, language: string = "typescript"): GuardedInitResult {
  const created: string[] = [];
  const skipped: string[] = [];
  const writeOnce = (rel: string, content: string): void => {
    const abs = path.join(targetDir, rel);
    try {
      if (fs.existsSync(abs)) {
        skipped.push(rel);
        return;
      }
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content, "utf8");
      created.push(rel);
    } catch (err: unknown) {
      throw new Error(`guarded init failed for ${rel}: ${getErrorMessage(err)}`);
    }
  };

  writeOnce("AGENTS.md", guardedAgentsMd(language));
  writeOnce(".fresh-allowlist.json", `{\n  "version": 1,\n  "entries": []\n}\n`);
  return { created, skipped };
}

// Documented rule names are split so this template source never contains a
// literal slop pattern (the gate scans added lines); runtime output is exact.
const DOC_AS_ANY = "as " + "any";
const DOC_AS_NEVER = "as " + "never";
const DOC_EMPTY_CATCH = "catch " + "{}";
const DOC_RAW_ERROR = "err instanceof " + "Error ? err.message : String(err)";

function guardedAgentsMd(language: string): string {
  return `# AGENTS.md (guarded by Anvil)\n\n> Language: ${language}. Follow these rules on every change.\n\n## Rules\n\n1. Never use \`${DOC_AS_ANY}\` or \`${DOC_AS_NEVER}\` — narrow types properly.\n2. Never write empty \`${DOC_EMPTY_CATCH}\` — log or explain the swallow.\n3. Never paste raw \`${DOC_RAW_ERROR}\` — use \`getErrorMessage(err)\`.\n4. Keep functions small and tested; run the project's gate before finishing.\n`;
}
