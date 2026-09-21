import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {
  projectHealthKey,
  recordHealthScan,
  loadHealthSnapshot,
  deriveHealth,
  formatHealth,
  healthSnapshotPath,
  HEALTH_TOP_RULES,
} from "../health.js";

/**
 * Phase 26.5 acceptance: freshness + allowlist drain rate tracked ACROSS
 * sessions (two recordings at different times against the same project root),
 * under a temp ANVIL_HOME so tests never touch the real one.
 */

let home: string;
let project: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-health-home-"));
  project = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-health-proj-"));
  process.env.ANVIL_HOME = home;
});

afterEach(() => {
  delete process.env.ANVIL_HOME;
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(project, { recursive: true, force: true });
});

function writeAllowlist(entries: { file: string; reason: string }[]): void {
  fs.writeFileSync(
    path.join(project, ".fresh-allowlist.json"),
    JSON.stringify({ version: 1, entries }, null, 2)
  );
}

const violation = (rule: string) => ({
  file: "src/a.ts",
  line: 1,
  rule,
  family: "style" as const,
  detail: "test violation",
});

describe("26.5 health — storage", () => {
  it("stores the snapshot under ANVIL_HOME/health/<12-char-hash>.json", () => {
    recordHealthScan(project, { scannedLines: 10, violations: [] });
    const key = projectHealthKey(project);
    expect(key).toMatch(/^[0-9a-f]{12}$/);
    expect(fs.existsSync(path.join(home, "health", `${key}.json`))).toBe(true);
  });

  it("different project roots map to different snapshot files", () => {
    const other = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-health-other-"));
    try {
      recordHealthScan(project, { scannedLines: 1, violations: [] });
      recordHealthScan(other, { scannedLines: 1, violations: [] });
      expect(projectHealthKey(project)).not.toBe(projectHealthKey(other));
    } finally {
      fs.rmSync(other, { recursive: true, force: true });
    }
  });
});

describe("26.5 health — freshness and counters across two sessions", () => {
  it("second recording updates freshness and accumulates counters", async () => {
    recordHealthScan(project, { scannedLines: 10, violations: [violation("no-as-any")] });
    const first = loadHealthSnapshot(project)!;
    expect(first.scansRun).toBe(1);
    expect(first.scannedLines).toBe(10);

    // Simulate the second session landing later.
    await new Promise((r) => setTimeout(r, 15));
    recordHealthScan(project, {
      scannedLines: 5,
      violations: [violation("no-as-any"), violation("no-empty-catch")],
    });
    const second = loadHealthSnapshot(project)!;

    expect(second.scansRun).toBe(2);
    expect(second.scannedLines).toBe(15);
    // Session 1: 10 scanned − 1 violation = 9 clean; session 2: 5 − 2 = 3.
    expect(second.cleanLines).toBe(12);
    expect(second.blockedByRule["no-as-any"]).toBe(2);
    expect(second.blockedByRule["no-empty-catch"]).toBe(1);
    expect(second.timestamp).toBeGreaterThan(first.timestamp);

    const derived = deriveHealth(second);
    expect(derived.freshnessMs).toBeLessThan(60_000);
    expect(derived.cleanliness).toBeCloseTo((12 / 15) * 100, 5);
  });

  it("an unrecorded project loads as null — honest empty state", () => {
    expect(loadHealthSnapshot(project)).toBeNull();
  });
});

describe("26.5 health — allowlist drain rate", () => {
  it("ratchets the high-water mark and computes the drain percent", () => {
    writeAllowlist([
      { file: "packages/core/src/a.ts", reason: "legacy shim 1" },
      { file: "packages/core/src/b.ts", reason: "legacy shim 2" },
      { file: "packages/core/src/c.ts", reason: "legacy shim 3" },
    ]);
    recordHealthScan(project, { scannedLines: 5, violations: [] });
    let derived = deriveHealth(loadHealthSnapshot(project)!);
    expect(derived.allowlistHigh).toBe(3);
    expect(derived.drainedPercent).toBe(0);

    // Session 2: one exception removed — the high stays, drain rises.
    writeAllowlist([
      { file: "packages/core/src/a.ts", reason: "legacy shim 1" },
      { file: "packages/core/src/b.ts", reason: "legacy shim 2" },
    ]);
    recordHealthScan(project, { scannedLines: 5, violations: [] });
    derived = deriveHealth(loadHealthSnapshot(project)!);
    expect(derived.allowlistHigh).toBe(3);
    expect(derived.allowlistEntries).toBe(2);
    expect(derived.drainedPercent).toBeCloseTo((1 / 3) * 100, 5);
  });

  it("drains to 100% when every exception is removed, and never goes negative", () => {
    writeAllowlist([{ file: "packages/core/src/a.ts", reason: "legacy shim" }]);
    recordHealthScan(project, { scannedLines: 1, violations: [] });
    writeAllowlist([]);
    recordHealthScan(project, { scannedLines: 1, violations: [] });
    const derived = deriveHealth(loadHealthSnapshot(project)!);
    expect(derived.allowlistEntries).toBe(0);
    expect(derived.allowlistHigh).toBe(1);
    expect(derived.drainedPercent).toBe(100);
  });

  it("a project with no allowlist history is not rendered as 0% drained", () => {
    recordHealthScan(project, { scannedLines: 1, violations: [] });
    const snapshot = loadHealthSnapshot(project)!;
    const derived = deriveHealth(snapshot);
    expect(derived.drainedPercent).toBe(100);
    expect(formatHealth(snapshot, project)).toContain("nothing to drain");
  });
});

describe("26.5 health — top rules and renderer", () => {
  it("ranks rules by count and caps at HEALTH_TOP_RULES", () => {
    const violations = [
      ...Array.from({ length: 5 }, () => violation("rule-a")),
      ...Array.from({ length: 3 }, () => violation("rule-b")),
      ...Array.from({ length: HEALTH_TOP_RULES + 2 }, () => violation(`rule-${crypto.randomUUID()}`)),
    ];
    recordHealthScan(project, { scannedLines: violations.length + 2, violations });
    const snapshot = loadHealthSnapshot(project)!;
    const derived = deriveHealth(snapshot);
    expect(derived.topRules.length).toBe(HEALTH_TOP_RULES);
    expect(derived.topRules[0]).toEqual({ rule: "rule-a", count: 5 });
    expect(derived.topRules[1]).toEqual({ rule: "rule-b", count: 3 });
  });

  it("formatHealth renders a stable report", () => {
    recordHealthScan(project, { scannedLines: 4, violations: [violation("no-as-any")] });
    const out = formatHealth(loadHealthSnapshot(project)!, project);
    expect(out).toContain("ANVIL CODEBASE HEALTH");
    expect(out).toContain("Cleanliness: 75.0%");
    expect(out).toContain("no-as-any: 1");
    expect(out).toContain("scan(s) recorded");
  });
});

describe("26.5 health — robustness", () => {
  it("a corrupted snapshot is discarded and rebuilt, not trusted", () => {
    recordHealthScan(project, { scannedLines: 10, violations: [] });
    fs.writeFileSync(healthSnapshotPath(project), "{ not json");
    expect(loadHealthSnapshot(project)).toBeNull();
    recordHealthScan(project, { scannedLines: 3, violations: [] });
    const snapshot = loadHealthSnapshot(project)!;
    expect(snapshot.scansRun).toBe(1);
    expect(snapshot.scannedLines).toBe(3);
  });

  it("a shape-valid-JSON snapshot (parses, wrong fields) is discarded, not dereferenced", () => {
    // Regression: readSnapshot only checked `timestamp`, so a truncated or
    // hand-edited file with a timestamp but no blockedByRule/scannedLines was
    // returned as a snapshot and crashed deriveHealth/formatHealth — an anvil
    // health crash on corruption instead of the honest empty state.
    recordHealthScan(project, { scannedLines: 10, violations: [] });
    fs.writeFileSync(
      healthSnapshotPath(project),
      JSON.stringify({ timestamp: Date.now(), scansRun: 1 })
    );
    expect(loadHealthSnapshot(project)).toBeNull();
  });

  it("negative scanned lines are clamped, never counted", () => {
    recordHealthScan(project, { scannedLines: -5, violations: [] });
    const snapshot = loadHealthSnapshot(project)!;
    expect(snapshot.scannedLines).toBe(0);
    expect(snapshot.cleanLines).toBe(0);
  });
});

