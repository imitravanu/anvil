import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runGuardedInit } from "../initGuarded.js";

/**
 * Direct unit tests for the `anvil init --guarded` wrapper. guardedInit
 * itself is covered in core; these pin the wrapper's contract: per-file
 * created/skipped reporting on stdout, exit 0 on partial skip, exit 1 with
 * the error on stderr when provisioning throws.
 */

let dir: string;
let stdout: string[];
let stderr: string[];
let outSpy: ReturnType<typeof vi.spyOn>;
let errSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-initguarded-"));
  stdout = [];
  stderr = [];
  outSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout.push(String(chunk));
    return true;
  });
  errSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr.push(String(chunk));
    return true;
  });
});

afterEach(() => {
  outSpy.mockRestore();
  errSpy.mockRestore();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("runGuardedInit", () => {
  it("provisions the guarded files into an empty directory and exits 0", () => {
    const code = runGuardedInit({ cwd: dir });
    expect(code).toBe(0);
    expect(fs.existsSync(path.join(dir, "AGENTS.md"))).toBe(true);
    expect(fs.existsSync(path.join(dir, ".anvil/rules"))).toBe(true);
    expect(fs.existsSync(path.join(dir, ".fresh-allowlist.json"))).toBe(true);
    expect(fs.existsSync(path.join(dir, ".githooks/pre-commit"))).toBe(true);
    // The hook must be executable — a non-executable hook is a silent no-op.
    const mode = fs.statSync(path.join(dir, ".githooks/pre-commit")).mode & 0o111;
    expect(mode).not.toBe(0);
    expect(stdout.join("")).toContain("created AGENTS.md");
    expect(stdout.join("")).toContain("created .githooks/pre-commit");
  });

  it("keeps existing files and reports them as skipped, still exiting 0", () => {
    fs.writeFileSync(path.join(dir, "AGENTS.md"), "# keep me\n");
    const code = runGuardedInit({ cwd: dir });
    expect(code).toBe(0);
    expect(fs.readFileSync(path.join(dir, "AGENTS.md"), "utf8")).toBe("# keep me\n");
    expect(stdout.join("")).toContain("kept existing AGENTS.md");
  });

  it("falls back to the typescript ruleset for an unknown language", () => {
    runGuardedInit({ cwd: dir, lang: "klingon" });
    const rules = fs.readFileSync(path.join(dir, ".anvil/rules"), "utf8");
    const ts = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-initguarded-ts-"));
    try {
      runGuardedInit({ cwd: ts, lang: "typescript" });
      expect(rules).toBe(fs.readFileSync(path.join(ts, ".anvil/rules"), "utf8"));
    } finally {
      fs.rmSync(ts, { recursive: true, force: true });
    }
  });

  it("exits 1 with the error on stderr when provisioning throws", () => {
    // Making .githooks a FILE forces the hook write's mkdir to fail with
    // ENOTDIR — guardedInit surfaces it as a thrown Error, which the wrapper
    // must report on stderr with exit 1.
    fs.writeFileSync(path.join(dir, "AGENTS.md"), "keep"); // skip: not the thrower
    fs.writeFileSync(path.join(dir, ".githooks"), "not a dir");
    const code = runGuardedInit({ cwd: dir });
    expect(code).toBe(1);
    expect(stderr.join("")).toContain("anvil init failed");
  });
});
