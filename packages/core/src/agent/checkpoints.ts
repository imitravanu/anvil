import fs from "node:fs/promises";
import path from "node:path";
import { resolveWithinRoot } from "../tools/paths.js";

// ---------------------------------------------------------------------------
// Rewind checkpoints: pre-mutation snapshots of write_file/edit_file targets.
// Memory-only, ring-bounded. // ---------------------------------------------------------------------------

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
 * rides inside the turn and must not break it. Async throughout: snapshots
 * run inside `send()` and must not block the event loop on big files.
 */
export async function takeSnapshot(projectRoot: string, id: number, paths: string[]): Promise<Checkpoint> {
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
    // Open-then-fstat-then-bounded-read: the size check and the read observe
    // the same open file description, so growth between check and read cannot
    // bust the caps (the old statSync+readFileSync pair had that TOCTOU).
    let fh: fs.FileHandle | null = null;
    try {
      fh = await fs.open(resolved, "r");
      const stat = await fh.stat();
      if (!stat.isFile() || stat.size > CHECKPOINT_FILE_MAX || total + stat.size > CHECKPOINT_TOTAL_MAX) {
        skipped += 1;
        continue;
      }
      const content = Buffer.alloc(stat.size);
      await fh.read(content, 0, stat.size, 0);
      total += content.length;
      files.push({ path: p, content });
    } catch {
      // Missing file is a legitimate snapshot (rewind deletes the creation);
      // only real read failures skip. Distinguish via existence.
      try {
        await fs.access(resolved);
        skipped += 1;
      } catch {
        files.push({ path: p, content: null });
      }
    } finally {
      await fh?.close().catch(() => undefined);
    }
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
        await fs.rm(resolved, { force: true });
        deleted.push(f.path);
      } else {
        await fs.mkdir(path.dirname(resolved), { recursive: true });
        await fs.writeFile(resolved, f.content);
        restored.push(f.path);
      }
    } catch (err: any) {
      errors.push(`${f.path}: ${err?.message ?? String(err)}`);
    }
  }
  return { restored, deleted, errors };
}
