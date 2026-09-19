import fs from "node:fs";
import path from "node:path";

/**
 * Phase S5 (F2) — who a scan is for.
 *
 * `"anvil"` means the scanned project IS Anvil's own monorepo, where the
 * Anvil-specific rule families are meaningful: they name `getErrorMessage`
 * from `@anvil/core`, the core/TUI/CLI package boundary, and `useTheme()` —
 * all of which exist only here. `"foreign"` means any other project — there
 * those rules can only misfire, because the APIs they reference do not exist
 * there. In particular the raw-error auto-fix rewrites code into a
 * `getErrorMessage(...)` call without adding an import, which in a foreign
 * project is a call to an undefined identifier.
 */
export type GuardianScope = "anvil" | "foreign";

/** Sentinel so a missing/unreadable file is never re-read on every scan. */
const CACHE = new Map<string, GuardianScope>();

/**
 * Detect whether `projectRoot` is Anvil's own monorepo. The signal is the
 * workspace package identity (`packages/core` declaring `@anvil/core`), which
 * is exactly the condition under which the Anvil-specific rules are true.
 * Never throws — an unreadable/malformed project is simply `"foreign"`.
 */
export function detectGuardianScope(projectRoot: string): GuardianScope {
  const cached = CACHE.get(projectRoot);
  if (cached !== undefined) return cached;

  let scope: GuardianScope = "foreign";
  try {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(projectRoot, "packages", "core", "package.json"), "utf8")
    ) as { name?: unknown };
    if (manifest.name === "@anvil/core") scope = "anvil";
  } catch {
    // intentional: no such package (or unreadable) means this is not the Anvil
    // repo, which is the same answer as a malformed manifest.
  }

  CACHE.set(projectRoot, scope);
  return scope;
}
