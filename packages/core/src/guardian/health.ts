import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { anvilHome, atomicWriteJson } from "../atomicWrite.js";
import { getErrorMessage } from "../errors.js";
import { loadFreshAllowlist } from "./allowlist.js";
import type { GuardianViolation } from "./scanner.js";

/**
 * Phase 26.5 — codebase health telemetry.
 * The adaptive-ratchet story: every `anvil gate` scan records what it saw into
 * a per-project snapshot under `ANVIL_HOME/health/`, so freshness, the
 * allowlist's drain rate, and the top blocked rule families are measurable
 * ACROSS sessions instead of claimed from memory. Storage is latest-only per
 * project (one JSON file keyed by the resolved root), with cumulative counters
 * inside — no history array to grow without bound.
 */

/** Top-N rule families rendered by `anvil health`. */
export const HEALTH_TOP_RULES = 5;

/** Snapshot schema version, so a future format change can be detected. */
const HEALTH_SNAPSHOT_VERSION = 1;

/** `<project-hash>.json` where <hash> is the first 12 hex chars of SHA-256(resolved root). */
export function projectHealthKey(projectRoot: string): string {
  const resolved = path.resolve(projectRoot);
  return crypto.createHash("sha256").update(resolved).digest("hex").slice(0, 12);
}

function healthDir(): string {
  return path.join(anvilHome(), "health");
}

export interface HealthSnapshot {
  version: number;
  /** Last recording time (epoch ms). */
  timestamp: number;
  /** Resolved project root the snapshot belongs to. */
  projectRoot: string;
  /** Cumulative across sessions. */
  scansRun: number;
  scannedLines: number;
  cleanLines: number;
  /** Violations by rule name, cumulative. */
  blockedByRule: Record<string, number>;
  /** Active allowlist entries at last recording. */
  allowlistEntries: number;
  /** Historical high-water mark of active allowlist entries. */
  allowlistHigh: number;
}

export interface ScanObservation {
  /** Added lines the scan judged. */
  scannedLines: number;
  violations: GuardianViolation[];
}

const EMPTY_SNAPSHOT: Omit<HealthSnapshot, "version" | "timestamp" | "projectRoot"> = {
  scansRun: 0,
  scannedLines: 0,
  cleanLines: 0,
  blockedByRule: {},
  allowlistEntries: 0,
  allowlistHigh: 0,
};

function readSnapshot(projectRoot: string): HealthSnapshot | null {
  const file = path.join(healthDir(), `${projectHealthKey(projectRoot)}.json`);
  if (!fs.existsSync(file)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    // A corrupted snapshot is discarded, not trusted — the next recording
    // rebuilds it. Telemetry must never become a gate failure.
    return null;
  }
  // Shape-validate the fields every consumer dereferences: a truncated or
  // hand-edited file that still parses as JSON would otherwise crash
  // `deriveHealth`/`formatHealth` (and `anvil health`) instead of being
  // discarded like any other corruption.
  if (typeof parsed !== "object" || parsed === null) return null;
  const s = parsed as Partial<HealthSnapshot>;
  if (
    typeof s.timestamp !== "number" ||
    typeof s.projectRoot !== "string" ||
    typeof s.scansRun !== "number" ||
    typeof s.scannedLines !== "number" ||
    typeof s.cleanLines !== "number" ||
    typeof s.allowlistEntries !== "number" ||
    typeof s.allowlistHigh !== "number" ||
    typeof s.blockedByRule !== "object" ||
    s.blockedByRule === null
  ) {
    return null;
  }
  return parsed as HealthSnapshot;
}

function writeSnapshot(projectRoot: string, snapshot: HealthSnapshot): void {
  const dir = healthDir();
  const file = path.join(dir, `${projectHealthKey(projectRoot)}.json`);
  try {
    // Synchronous + atomic: the recording is the last thing a gate run does,
    // and a fire-and-forget async write could be lost at process exit.
    atomicWriteJson(file, snapshot, { mode: 0o600 });
  } catch (err: unknown) {
    // Telemetry is best-effort: a read-only home must not fail the scan that
    // fed it.
    console.warn(`[guardian] could not record health snapshot: ${getErrorMessage(err)}`);
  }
}

/**
 * Record one gate scan into the project's snapshot, merging with whatever
 * previous sessions recorded. Derived honestly: the allowlist high-water mark
 * is a MAX (it can only ratchet up), violation counts accumulate, and the
 * active-entry count is refreshed from the CURRENT allowlist file.
 */
export function recordHealthScan(projectRoot: string, scan: ScanObservation): HealthSnapshot {
  const resolved = path.resolve(projectRoot);
  const previous = readSnapshot(resolved);
  const base: HealthSnapshot = previous ?? {
    version: HEALTH_SNAPSHOT_VERSION,
    timestamp: 0,
    projectRoot: resolved,
    ...EMPTY_SNAPSHOT,
  };

  const blockedByRule: Record<string, number> = { ...base.blockedByRule };
  for (const v of scan.violations) {
    blockedByRule[v.rule] = (blockedByRule[v.rule] ?? 0) + 1;
  }

  const allowlist = loadFreshAllowlist(resolved);

  const snapshot: HealthSnapshot = {
    ...base,
    version: HEALTH_SNAPSHOT_VERSION,
    timestamp: Date.now(),
    projectRoot: resolved,
    scansRun: base.scansRun + 1,
    scannedLines: base.scannedLines + Math.max(0, scan.scannedLines),
    cleanLines: base.cleanLines + Math.max(0, scan.scannedLines - scan.violations.length),
    blockedByRule,
    allowlistEntries: allowlist.entries.length,
    allowlistHigh: Math.max(base.allowlistHigh, allowlist.entries.length),
  };
  writeSnapshot(resolved, snapshot);
  return snapshot;
}

/** Latest snapshot for a project, or null when nothing was ever recorded. */
export function loadHealthSnapshot(projectRoot: string): HealthSnapshot | null {
  return readSnapshot(path.resolve(projectRoot));
}

export interface HealthDerived {
  /** Percentage of scanned added lines with no violation (0–100). */
  cleanliness: number;
  /** Active allowlist entries vs the historical high, plus the drain percent. */
  allowlistEntries: number;
  allowlistHigh: number;
  drainedPercent: number;
  /** Age of the last scan in milliseconds. */
  freshnessMs: number;
  topRules: { rule: string; count: number }[];
  scansRun: number;
}

/**
 * Derive display metrics. A never-used allowlist (high 0) is NOT rendered as
 * "0% drained" — with no exceptions there is nothing to drain, so the drain
 * percent is defined as 100 and the renderer says so plainly.
 */
export function deriveHealth(snapshot: HealthSnapshot): HealthDerived {
  const cleanliness =
    snapshot.scannedLines > 0 ? (snapshot.cleanLines / snapshot.scannedLines) * 100 : 0;
  const allowlistHigh = snapshot.allowlistHigh;
  const allowlistEntries = snapshot.allowlistEntries;
  const drainedPercent =
    allowlistHigh === 0
      ? 100
      : Math.max(0, Math.min(100, ((allowlistHigh - allowlistEntries) / allowlistHigh) * 100));
  const topRules = Object.entries(snapshot.blockedByRule)
    .map(([rule, count]) => ({ rule, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, HEALTH_TOP_RULES);
  return {
    cleanliness,
    allowlistEntries,
    allowlistHigh,
    drainedPercent,
    freshnessMs: Date.now() - snapshot.timestamp,
    topRules,
    scansRun: snapshot.scansRun,
  };
}

function formatAge(ms: number): string {
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}

/** Stable plain-text render of `anvil health` (latest-only, per spec). */
export function formatHealth(snapshot: HealthSnapshot, projectRoot: string): string {
  const d = deriveHealth(snapshot);
  const lines: string[] = [];
  lines.push("===============================================================================");
  lines.push(` ANVIL CODEBASE HEALTH — ${projectRoot}`);
  lines.push("-------------------------------------------------------------------------------");
  lines.push(` Last scan: ${formatAge(d.freshnessMs)} (${d.scansRun} scan(s) recorded)`);
  lines.push(
    ` Cleanliness: ${d.cleanliness.toFixed(1)}% of ${snapshot.scannedLines} scanned added line(s) free of slop`
  );
  if (snapshot.allowlistHigh === 0) {
    lines.push(" Allowlist: no exceptions on record — nothing to drain");
  } else {
    lines.push(
      ` Allowlist drain: ${d.allowlistEntries} active / ${d.allowlistHigh} historical high — ${d.drainedPercent.toFixed(0)}% drained`
    );
  }
  if (d.topRules.length === 0) {
    lines.push(" Top blocked rules: none recorded yet");
  } else {
    lines.push(" Top blocked rule families:");
    for (const { rule, count } of d.topRules) {
      lines.push(`   ${rule}: ${count}`);
    }
  }
  lines.push("===============================================================================");
  return lines.join("\n");
}

/** Where this project's snapshot lives (exposed for tests). */
export function healthSnapshotPath(projectRoot: string): string {
  return path.join(healthDir(), `${projectHealthKey(projectRoot)}.json`);
}
