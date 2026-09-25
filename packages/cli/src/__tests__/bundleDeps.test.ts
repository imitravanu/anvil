import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * PACKAGING GUARD
 *
 * `esbuild --external:<pkg>` leaves a real `import "<pkg>"` at the top of
 * dist/index.js, so the published CLI resolves that package from node_modules
 * when it loads. If the package is not declared in THIS package's
 * `dependencies`, a clean install has no copy of it and `anvil` dies on its
 * first import — before it can even print a version. The in-repo gate
 * structurally cannot catch that: the monorepo hoists node_modules, so every
 * build and test resolves the package anyway. Deriving the expectation from the
 * build script makes the class mechanical — externalize a package without
 * declaring it and this fails.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../");

interface Pkg {
  scripts: { build: string };
  dependencies?: Record<string, string>;
}

const readPkg = (rel: string): Pkg => JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf-8"));

const CLI = readPkg("packages/cli/package.json");
const CORE = readPkg("packages/core/package.json");

/** Every `--external:` package named in the CLI build script, in flag order. */
function externals(): string[] {
  return [...CLI.scripts.build.matchAll(/--external:([^\s"']+)/g)].map((m) => m[1]!);
}

describe("cli bundle packaging", () => {
  it("declares every externalized package as a runtime dependency", () => {
    const flags = externals();
    // A guard that silently checks nothing is worse than no guard.
    expect(flags.length).toBeGreaterThan(0);
    for (const name of flags) {
      expect(CLI.dependencies?.[name], `${name} is --external but not a dependency`).toBeDefined();
    }
  });

  it("keeps an externalized version in step with @anvil/core (one runtime copy)", () => {
    for (const name of externals()) {
      expect(CLI.dependencies?.[name], `${name} version has drifted from @anvil/core`).toBe(
        CORE.dependencies?.[name]
      );
    }
  });
});
