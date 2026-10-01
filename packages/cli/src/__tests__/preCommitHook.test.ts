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
 * `@anvil/(tui|cli)`, so a legal CLI→TUI import (cli/index.tsx already has one)
 * failed the hook. Only `packages/core/` files may never import tui/cli.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../");
const HOOK = path.join(ROOT, ".githooks", "pre-commit");

function git(cwd: string, args: string[]): void {
  const res = spawnSync("git", args, { cwd, encoding: "utf-8" });
  if (res.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${res.stderr || res.stdout}`);
  }
}

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
      'import { App } from "@anvil/tui";\nexport const x = App;\n'
    );
    expect(code, "a legal cli→tui import must not be blocked").toBe(0);
  });

  it("still refuses a core→tui import", () => {
    const code = runHookOnStaged(
      "packages/core/src/illegal.ts",
      'import { App } from "@anvil/tui";\nexport const x = App;\n'
    );
    expect(code, "core must never import tui").toBe(1);
  });

  it("exempts core tests, matching the gate", () => {
    const code = runHookOnStaged(
      "packages/core/src/__tests__/boundary.test.ts",
      'import { App } from "@anvil/tui";\nexport const x = App;\n'
    );
    expect(code, "core test fixtures may reference tui/cli").toBe(0);
  });

  it("still catches slop in a core file (raw error ternary)", () => {
    const code = runHookOnStaged(
      "packages/core/src/slop.ts",
      "export const m = (e: unknown) => (e instanceof Error ? e.message : String(e));\n"
    );
    expect(code, "raw error formatting must be refused").toBe(1);
  });
});