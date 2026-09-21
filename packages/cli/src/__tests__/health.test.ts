import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

/**
 * `anvil health` renders a snapshot recorded under ANVIL_HOME by gate scans.
 * The tests drive the real read/render path — no mocks — by pointing
 * ANVIL_HOME at a temp dir and using core's own recordHealthScan to write
 * real snapshots (same pattern as firstRunSetup.test.tsx: env relocation,
 * not module mocks).
 */
import { runHealth } from "../health.js";
import { recordHealthScan } from "@anvil/core";

let home: string;
let originalHome: string | undefined;
let stdout: string[];
let stderr: string[];
let outSpy: ReturnType<typeof vi.spyOn>;
let errSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-health-"));
  originalHome = process.env.ANVIL_HOME;
  process.env.ANVIL_HOME = home;
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
  if (originalHome === undefined) delete process.env.ANVIL_HOME;
  else process.env.ANVIL_HOME = originalHome;
  fs.rmSync(home, { recursive: true, force: true });
});

describe("runHealth", () => {
  it("prints the honest empty state and exits 0 when no scan was ever recorded", () => {
    const code = runHealth({ cwd: "/nonexistent-project-for-health-test" });
    expect(code).toBe(0);
    expect(stdout.join("")).toContain("no scans recorded");
    expect(stdout.join("")).toContain("anvil gate");
  });

  it("renders the recorded snapshot for the current project", () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-health-proj-"));
    try {
      recordHealthScan(project, { scannedLines: 10, violations: [] });
      const code = runHealth({ cwd: project });
      expect(code).toBe(0);
      const out = stdout.join("");
      expect(out).toContain("ANVIL CODEBASE HEALTH");
      expect(out).toContain("10 scanned added line(s)");
    } finally {
      fs.rmSync(project, { recursive: true, force: true });
    }
  });

  it("treats an unreadable snapshot (EISDIR) as no data, not a crash", () => {
    // A directory where the snapshot file belongs makes the read throw EISDIR;
    // core's read contract discards it, so the CLI shows the honest empty
    // state. The file name must match the key core derives: first 12 hex
    // chars of sha256(resolved project root).
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-health-bad-"));
    try {
      const healthDir = path.join(home, "health");
      fs.mkdirSync(healthDir, { recursive: true });
      const key = createHash("sha256").update(path.resolve(project)).digest("hex").slice(0, 12);
      fs.mkdirSync(path.join(healthDir, `${key}.json`));
      const code = runHealth({ cwd: project });
      expect(code).toBe(0);
      expect(stdout.join("")).toContain("no scans recorded");
    } finally {
      fs.rmSync(project, { recursive: true, force: true });
    }
  });

  it("treats a shape-corrupt snapshot as no data, not a crash", () => {
    // Core discards snapshots whose fields don't match the schema (pinned in
    // core's suite); from the CLI's side that must surface as the honest
    // empty state, not an exception mid-render.
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-health-corrupt-"));
    try {
      const healthDir = path.join(home, "health");
      fs.mkdirSync(healthDir, { recursive: true });
      const key = createHash("sha256").update(path.resolve(project)).digest("hex").slice(0, 12);
      fs.writeFileSync(
        path.join(healthDir, `${key}.json`),
        JSON.stringify({ timestamp: Date.now(), scansRun: 1 })
      );
      const code = runHealth({ cwd: project });
      expect(code).toBe(0);
      expect(stdout.join("")).toContain("no scans recorded");
    } finally {
      fs.rmSync(project, { recursive: true, force: true });
    }
  });
});
