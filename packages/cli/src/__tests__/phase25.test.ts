import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runNativeGate } from "../gate.js";
import { runGuardedInit } from "../initGuarded.js";

describe("anvil gate (native fast scan)", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it("reports failure outside a git repo", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-gate-"));
    try {
      expect(runNativeGate({ cwd: dir })).toBe(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("anvil init --guarded", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it("provisions gates and keeps existing files", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-init-"));
    try {
      expect(runGuardedInit({ cwd: dir, lang: "python" })).toBe(0);
      expect(fs.existsSync(path.join(dir, "AGENTS.md"))).toBe(true);
      expect(fs.readFileSync(path.join(dir, "AGENTS.md"), "utf8")).toContain("python");
      expect(runGuardedInit({ cwd: dir })).toBe(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
