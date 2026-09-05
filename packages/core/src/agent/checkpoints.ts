import fs from "node:fs";
import path from "node:path";
import { resolveWithinRoot } from "../tools/paths.js";

// ---------------------------------------------------------------------------
// Rewind checkpoints: pre-mutation snapshots of write_file/edit_file targets.
// Memory-only, ring-bounded. See docs/REWIND-SPEC.md.
// ---------------------------------------------------------------------------

export interface FileSnapshot {
  /** Project-root-relative path as the tool call gave it. */
  path: string;
  /** Original bytes, or null when the file did not exist (rewind deletes it). */
  content: Buffer | null;
}

export interface Checkpoint {
  id: number;
  ts: string;
  files: FileSnapshot[];
  /** Targets skipped (unresolvable path, oversized, malformed) — never throws. */
  skipped: number;
}

/** Ring size per session. */
export const CHECKPOINT_KEEP = 5;
/** Per-file cap — matches the tool read/write caps, so any tool-touched file fits. */
export const CHECKPOINT_FILE_MAX = 512 * 1024;
/** Per-checkpoint byte cap across snapshotted files. */
export const CHECKPOINT_TOTAL_MAX = 2 * 1024 * 1024;

export interface CheckpointMeta {
  id: number;
  ts: string;
  files: number;
  skipped: number;
}

/** Metadata view for UI listing — contents never leave the session. */
export function checkpointMeta(cp: Checkpoint): CheckpointMeta {
  return { id: cp.id, ts: cp.ts, files: cp.files.length, skipped: cp.skipped };
}

/**
 * Snapshot `paths` against `projectRoot` with an assigned id. Hostile or
 * malformed targets are SKIPPED (counted), never thrown — checkpoint code
 * rides inside the turn and must not break it.
 */
export function takeSnapshot(projectRoot: string, id: number, paths: string[]): Checkpoint {
  const files: FileSnapshot[] = [];
  let skipped = 0;
  let total = 0;
  for (const p of paths) {
    if (typeof p !== "string" || p.length === 0) {
      skipped += 1;
      continue;
    }
    let resolved: string;
    try {
      resolved = resolveWithinRoot(projectRoot, p);
    } catch {
      skipped += 1;
      continue;
    }
    let content: Buffer | null = null;
    try {
      const stat = fs.statSync(resolved);
      if (!stat.isFile()) {
        skipped += 1;
        continue;
      }
      if (stat.size > CHECKPOINT_FILE_MAX || total + stat.size > CHECKPOINT_TOTAL_MAX) {
        skipped += 1;
        continue;
      }
      content = fs.readFileSync(resolved);
      total += content.length;
    } catch {
      // Missing file is a legitimate snapshot (rewind deletes the creation);
      // only real read failures skip. Distinguish via existsSync.
      if (fs.existsSync(resolved)) {
        skipped += 1;
        continue;
      }
      content = null;
    }
    files.push({ path: p, content });
  }
  return { id, ts: new Date().toISOString(), files, skipped };
}

/** Keep the newest KEEP checkpoints (oldest dropped). Pure. */
export function capCheckpoints(list: readonly Checkpoint[]): Checkpoint[] {
  if (list.length <= CHECKPOINT_KEEP) return [...list];
  return list.slice(list.length - CHECKPOINT_KEEP);
}

export interface RestoreResult {
  restored: string[];
  deleted: string[];
  errors: string[];
}

/**
 * Restore a checkpoint: write back originals (creating parent dirs), delete
 * files that did not exist. Every path is re-resolved — a checkpoint must
 * never become a path-escape vector itself.
 */
export async function restoreCheckpoint(
  projectRoot: string,
  cp: Checkpoint
): Promise<RestoreResult> {
  const restored: string[] = [];
  const deleted: string[] = [];
  const errors: string[] = [];
  for (const f of cp.files) {
    let resolved: string;
    try {
      resolved = resolveWithinRoot(projectRoot, f.path);
    } catch {
      errors.push(`${f.path}: path escapes project root`);
      continue;
    }
    try {
      if (f.content === null) {
        fs.rmSync(resolved, { force: true });
        deleted.push(f.path);
      } else {
        fs.mkdirSync(path.dirname(resolved), { recursive: true });
        fs.writeFileSync(resolved, f.content);
        restored.push(f.path);
      }
    } catch (err: any) {
      errors.push(`${f.path}: ${err?.message ?? String(err)}`);
    }
  }
  return { restored, deleted, errors };
}
