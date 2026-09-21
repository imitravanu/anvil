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

const ENTRY_FILE_RE = /^packages\/[^/]+\/src\//;

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
      // Mirror the gate's own shape rule: broad entries are rejected, not trusted.
      if (!ENTRY_FILE_RE.test(file) || reason.trim().length < 4) {
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
