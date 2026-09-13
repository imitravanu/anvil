import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

/**
 * GATE INTEGRITY SENTINEL (hardening, 2026-09-13)
 *
 * The gate (scripts/verify-gate.mjs) is itself a repo artifact that an agent
 * with write access could weaken. This test lives OUTSIDE the gate, in the
 * normal vitest suite, and asserts the gate still:
 *   - enforces every anti-slop rule regex,
 *   - fails hard (no silent skips / no-op steps),
 *   - scans untracked files and CI merge-base diffs (no blind spots),
 *   - validates the allowlist shape (no weaponized broad entries),
 *   - wires the integrity manifest + protected-path acknowledgement.
 * CI runs `npm test` independently of `npm run gate`, so gutting the gate
 * without also gutting this test fails CI.
 *
 * NOTE: this file is itself a protected artifact (hashed in
 * scripts/gate-manifest.json). Intentional changes REQUIRE the manifest update
 * in the same commit + human review (the gate refuses locally without
 * --ack-protected-change).
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../");
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), "utf-8");

describe("gate integrity sentinel", () => {
  it("gate script exists and is non-empty", () => {
    const gate = read("scripts/verify-gate.mjs");
    expect(gate.length).toBeGreaterThan(2000);
  });

  it("every anti-slop rule regex is still enforced", () => {
    const gate = read("scripts/verify-gate.mjs");
    expect(gate).toContain("as\\s+(any|never)"); // rule: no `as any` / `as never`
    expect(gate).toContain("catch\\s*"); // rule: no silent catch blocks
    expect(gate).toContain("@anvil/tui"); // rule: core must not import tui
    expect(gate).toContain("instanceof\\s+Error"); // rule: use getErrorMessage
    expect(gate).toContain("TODO|FIXME|XXX"); // rule: no placeholders
    expect(gate).toContain("borderColor|backgroundColor"); // rule: no hardcoded colors
  });

  it("failure wiring is intact (gate cannot be no-op'd)", () => {
    const gate = read("scripts/verify-gate.mjs");
    expect(gate).toContain("process.exit(1)");
    expect(gate).toContain("function fail(");
    expect(gate).toContain("function pass(");
    expect(gate).toContain("logStep(0");
    expect(gate).toContain("logStep(5");
  });

  it("diff scanning has no blind spots (CI-aware base, untracked files, no silent skip)", () => {
    const gate = read("scripts/verify-gate.mjs");
    expect(gate).toContain("git diff");
    expect(gate).toContain("ls-files --others --exclude-standard");
    expect(gate).toContain("GITHUB_BASE_REF");
    expect(gate).not.toContain("Git diff scan skipped or no changes detected");
  });

  it("integrity manifest and protected-path gates are wired", () => {
    const gate = read("scripts/verify-gate.mjs");
    expect(gate).toContain("gate-manifest.json");
    expect(gate).toContain("--ack-protected-change");
    expect(gate).toContain("PROTECTED_PATHS");
  });

  it("allowlist cannot be weaponized (entry shape is validated)", () => {
    const gate = read("scripts/verify-gate.mjs");
    expect(gate).toContain("ENTRY_FILE_RE");
  });

  it("constitution has not been watered down", () => {
    const agents = read("AGENTS.md");
    expect(agents).toContain("npm run gate");
    expect(agents).toContain("Anti-Slop");
    expect(agents).toContain("getErrorMessage");
    expect(agents).toContain("PHASE-21-25-AUDIT.md");
    expect(agents).toContain("Protected Artifact");
  });

  it("integrity manifest covers every protected artifact and matches live content", () => {
    const manifest = JSON.parse(read("scripts/gate-manifest.json"));
    const required = [
      "scripts/verify-gate.mjs",
      "AGENTS.md",
      ".fresh-allowlist.json",
      "docs/PHASE-21-25-AUDIT.md",
      "packages/cli/src/__tests__/gate.sentinel.test.ts",
      ".githooks/pre-commit",
      ".github/workflows/ci.yml",
      ".github/workflows/live-eval.yml",
      ".github/workflows/release.yml",
      ".github/workflows/visual-regression.yml",
    ];
    expect(manifest.hashes).toBeTypeOf("object");
    // Exact coverage: a protected file must never be drafted out of the manifest.
    expect(Object.keys(manifest.hashes).sort()).toEqual(required.sort());
    for (const rel of required) {
      const stored = manifest.hashes[rel];
      expect(stored).toMatch(/^[0-9a-f]{64}$/);
      const live = createHash("sha256").update(read(rel)).digest("hex");
      expect(live, `live hash of ${rel} drifts from the committed manifest`).toBe(stored);
    }
  });

  it("residual drain scan (Step 1.5) is wired and allowlist-free", () => {
    const gate = read("scripts/verify-gate.mjs");
    expect(gate).toContain("STEP 1.5");
    expect(gate).toContain("RESIDUAL_RULES");
    expect(gate).toContain("walkSourceFiles");
    expect(gate).toContain(".message\\s*\\?\\?\\s*String\\(");
    expect(gate).toContain("Full-tree residual scan clean");
    // Residual debt must not be suppressible via the allowlist.
    expect(gate.indexOf("STEP 1.5")).toBeLessThan(gate.indexOf("Full-tree residual scan clean"));
  });

  it("commit-time enforcement (pre-commit hook) is self-contained and attacker-proof", () => {
    const hook = read(".githooks/pre-commit");
    // PROVEN ATTACK: a hook that executes scripts/verify-gate.mjs is
    // attacker-controlled (the agent weakens the script AND flips its exit
    // code). The hook must decide from the staged diff alone.
    expect(hook).not.toMatch(/exec\s+.*verify-gate\.mjs/);
    expect(hook).not.toMatch(/node\s+scripts\/verify-gate\.mjs/);
    expect(hook).toContain("git diff --cached --name-only");
    expect(hook).toContain("PROTECTED ARTIFACT CHANGE DETECTED");
    expect(hook).toContain("exit 1");
    expect(hook).toContain("any|never"); // slop scan layer present
    // The hook must never smuggle the human-ack flag: a protected change must
    // always require the explicit flag (or --no-verify, which is loud).
    expect(hook).not.toContain("--ack-protected-change");
    const gate = read("scripts/verify-gate.mjs");
    expect(gate).toContain(".githooks/pre-commit"); // protected path coverage
  });

  it("CI still enforces tests, the gate, and full clone depth", () => {
    const ci = read(".github/workflows/ci.yml");
    expect(ci).toContain("npm test");
    expect(ci).toContain("npm run gate");
    expect(ci).toContain("fetch-depth: 0");
  });
});