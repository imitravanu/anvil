import fs from "node:fs";
import { getErrorMessage } from "../errors.js";
import { resolveWithinRoot } from "../tools/paths.js";
import { log } from "../logger.js";

/**
 * Phase 26.0 — `.fresh-allowlist.json` reader.
 * `guardedInit` writes the file; this is the missing read side (the 26.5
 * drain-rate telemetry data source). Validated against the same shape the
 * repo gate enforces: `{ version, entries: [{ file, reason }] }`.
 */
export interface FreshAllowlistEntry {
  file: string;
  reason: string;
}

export interface FreshAllowlist {
  /** True when a syntactically valid file was found and parsed. */
  present: boolean;
  version: number;
  entries: FreshAllowlistEntry[];
  /** Entries dropped for a malformed shape (reported, never silently accepted). */
  rejected: number;
}

const EMPTY: FreshAllowlist = { present: false, version: 0, entries: [], rejected: 0 };

/**
 * AUDIT-05 (2026-09-26): an allowlist entry must name a repo-relative SOURCE
 * FILE — never a directory, glob, absolute path, `..` traversal, or non-source
 * file. Previously the shape rule required `packages/<pkg>/src/`, which is
 * meaningless in foreign repos provisioned by `anvil init --guarded` (their
 * natural layout is `src/...`), so legitimate entries were counted rejected
 * here and hard-failed the repo gate. This predicate is byte-for-byte the same
 * logic as `isValidSourceFilePath` in scripts/verify-gate.mjs; a parity test
 * in the CLI sentinel suite fails if the two drift.
 */
const SOURCE_FILE_EXT_RE = /\.[cm]?[jt]sx?$/;

export function isValidSourceFilePath(file: unknown): boolean {
  if (typeof file !== "string" || file.length === 0) return false;
  if (file.startsWith("/") || file.includes("\\")) return false;
  if (file.includes("..")) return false;
  if (file.includes("*")) return false;
  if (file.endsWith("/")) return false;
  if (file.split("/").includes(".") || file.split("/").includes("..")) return false;
  return SOURCE_FILE_EXT_RE.test(file);
}

/**
 * Read and validate a project's allowlist. A missing file is a normal empty
 * result; a malformed file reports `present: false` (never half-loads).
 */
export function loadFreshAllowlist(projectRoot: string): FreshAllowlist {
  let resolved: string;
  try {
    resolved = resolveWithinRoot(projectRoot, ".fresh-allowlist.json");
  } catch (err: unknown) {
    log.warn(`[guardian] allowlist path rejected: ${getErrorMessage(err)}`);
    return EMPTY;
  }
  if (!fs.existsSync(resolved)) return EMPTY;

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(resolved, "utf8"));
  } catch (err: unknown) {
    log.warn(`[guardian] allowlist is not valid JSON: ${getErrorMessage(err)}`);
    return EMPTY;
  }
  if (typeof parsed !== "object" || parsed === null || !Array.isArray((parsed as { entries?: unknown }).entries)) {
    log.warn("[guardian] allowlist missing an entries array — ignored");
    return EMPTY;
  }

  const rawEntries = (parsed as { entries: unknown[] }).entries;
  const entries: FreshAllowlistEntry[] = [];
  let rejected = 0;
  for (const entry of rawEntries) {
    if (
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as { file?: unknown }).file === "string" &&
      typeof (entry as { reason?: unknown }).reason === "string"
    ) {
      const file = (entry as { file: string }).file;
      const reason = (entry as { reason: string }).reason;
      // Mirror the gate's own shape rule (AUDIT-05): broad or non-source
      // entries are rejected, not trusted.
      if (!isValidSourceFilePath(file) || reason.trim().length < 4) {
        rejected += 1;
        continue;
      }
      entries.push({ file, reason });
    } else {
      rejected += 1;
    }
  }

  const version = typeof (parsed as { version?: unknown }).version === "number" ? (parsed as { version: number }).version : 0;
  return { present: true, version, entries, rejected };
}
