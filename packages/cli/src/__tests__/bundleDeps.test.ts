import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * PACKAGING GUARD — the CLI ships ONE self-contained bundle.
 *
 * `esbuild --bundle` inlines every dependency into `dist/index.js`, so the
 * published package declares no runtime `dependencies` and a clean install needs
 * nothing beyond the tarball.
 *
 * `esbuild --external:<pkg>` breaks that silently: it leaves a real
 * `import "<pkg>"` at the top of the bundle, which a clean install cannot
 * resolve because the package is not installed. The monorepo hoists
 * node_modules, so every build and test still passes here and NO gate step
 * notices — this exact defect shipped once (the three provider SDKs).
 *
 * The externalized build was also measured, not assumed: it did NOT improve
 * startup (485–739 ms vs 474–594 ms bundled — the run-to-run spread exceeds the
 * difference) and only shrank the bundle ~42%. So self-containment is the
 * decision. Re-adding an `--external` flag is a deliberate change: add the
 * package to `dependencies` AND update this guard in the same commit.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../");

interface Pkg {
  scripts: { build: string };
  dependencies?: Record<string, string>;
}

const CLI: Pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "packages/cli/package.json"), "utf-8"));

/** Every `--external:` package named in the CLI build script, in flag order. */
function externals(): string[] {
  return [...CLI.scripts.build.matchAll(/--external:([^\s"']+)/g)].map((m) => m[1]!);
}

describe("cli bundle packaging", () => {
  it("externalizes nothing — the bundle stays self-contained", () => {
    expect(
      externals(),
      "an --external package is imported at runtime by a clean install that never installed it; declare it in dependencies and update this guard"
    ).toEqual([]);
  });

  it("declares no runtime dependencies, matching a bundle that inlines them all", () => {
    // Keep the two in step: a dependency with no `--external` flag would be dead
    // weight in the manifest (it is bundled anyway), and an `--external` flag
    // with no dependency is the unresolved-import defect.
    expect(Object.keys(CLI.dependencies ?? {})).toEqual([]);
  });
});
