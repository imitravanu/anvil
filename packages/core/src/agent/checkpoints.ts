import { getErrorMessage } from "../errors.js";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { constants as FS_CONSTANTS } from "node:fs";
import path from "node:path";
import { createTwoFilesPatch } from "diff";
import { resolveWithinRoot } from "../tools/paths.js";

// ---------------------------------------------------------------------------
// Rewind checkpoints: pre-mutation snapshots of write_file/edit_file targets.
// Persisted per session under $ANVIL_HOME/checkpoints (see checkpointStore.ts),
// ring-bounded by CHECKPOINT_KEEP.
// ---------------------------------------------------------------------------

export interface FileSnapshot {
  /** Project-root-relative path as the tool call gave it. */
  path: string;
  /** Original bytes, or null when the file did not exist (rewind deletes it). */
  content: Buffer | null;
  /**
   * Fingerprint of the file's bytes immediately after this session's mutation
   * completed, or null when nothing was readable there. `undefined` means the
   * record is absent (a snapshot predating this field), so the current on-disk
   * state cannot be judged — see `restoreCheckpoint`.
   */
  postHash?: string | null;
}

export interface Checkpoint {
  id: number;
  ts: string;
  files: FileSnapshot[];
  /** Targets skipped (unresolvable path, oversized, malformed) — never throws. */
  skipped: number;
}

/** Ring size per session. */
import { CHECKPOINT_KEEP, CHECKPOINT_FILE_MAX, CHECKPOINT_TOTAL_MAX } from "../config/constants.js";
import { atomicWriteBuffer } from "../atomicWrite.js";
import { log } from "../logger.js";
export { CHECKPOINT_KEEP, CHECKPOINT_FILE_MAX, CHECKPOINT_TOTAL_MAX };

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
      // intentional: a path outside the project root cannot be snapshotted, so
      // it is counted as skipped (reported in the snapshot's `skipped`) rather
      // than aborting the whole snapshot.
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
      const { bytesRead } = await fh.read(content, 0, stat.size, 0);
      const finalBuf = bytesRead === stat.size ? content : content.subarray(0, bytesRead);
      total += finalBuf.length;
      files.push({ path: p, content: finalBuf });
    } catch {
      // Missing file is a legitimate snapshot (rewind deletes the creation);
      // only real read failures skip. Distinguish via existence.
      try {
        await fs.access(resolved);
        skipped += 1;
      } catch {
        // intentional: fs.access throwing here means the path is absent, which
        // IS a legitimate snapshot (its content is null; a rewind deletes the
        // file the session created). Only a present-but-unreadable file skips.
        files.push({ path: p, content: null });
      }
    } finally {
      // intentional: closing is best-effort — a close failure must not discard
      // an already-read snapshot.
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
  /**
   * Targets whose on-disk bytes differ from the last state this session left
   * them in. These are preserved, and the restore is refused.
   */
  externallyModified: string[];
}

/** Fingerprint for the external-edit check. `null` = no readable bytes there. */
export function hashBytes(buf: Buffer | null): string | null {
  return buf === null ? null : createHash("sha256").update(buf).digest("hex");
}

/** Current fingerprint of a root-relative path; null when unreadable/missing. */
export async function fingerprintPath(projectRoot: string, path: string): Promise<string | null> {
  try {
    return hashBytes(await fs.readFile(resolveWithinRoot(projectRoot, path)));
  } catch {
    // Missing is a state; a failed read is treated the same way rather than
    // throwing out of checkpoint code, which rides inside the turn.
    return null;
  }
}

/**
 * The session's last recorded post-mutation fingerprint for `path`: the
 * highest-id checkpoint carrying one. Comparing against THIS — rather than the
 * restored checkpoint's own post-state — is what keeps a rewind that discards
 * the session's own later writes from being misreported as an outside edit.
 */
function latestPostState(
  sessionState: readonly Checkpoint[],
  path: string
): { known: boolean; hash: string | null } {
  let bestId = Number.NEGATIVE_INFINITY;
  let found: string | null | undefined;
  for (const cp of sessionState) {
    for (const f of cp.files) {
      if (f.path !== path || f.postHash === undefined) continue;
      if (cp.id > bestId) {
        bestId = cp.id;
        found = f.postHash;
      }
    }
  }
  return found === undefined ? { known: false, hash: null } : { known: true, hash: found };
}

/**
 * Restore a checkpoint: write back originals (creating parent dirs), delete
 * files that did not exist. Every path is re-resolved — a checkpoint must
 * never become a path-escape vector itself.
 *
 * `sessionState` is the live checkpoint ring (defaults to just `cp`), used to
 * report targets that changed on disk since the session last wrote them.
 */
export async function restoreCheckpoint(
  projectRoot: string,
  cp: Checkpoint,
  sessionState: readonly Checkpoint[] = [cp]
): Promise<RestoreResult> {
  const restored: string[] = [];
  const deleted: string[] = [];
  const errors: string[] = [];
  const externallyModified: string[] = [];

  // A rewind must never erase later user edits. Preflight the whole checkpoint
  // before changing any target; legacy snapshots without a post-state cannot
  // prove the current file still belongs to this session.
  for (const f of cp.files) {
    const { known, hash } = latestPostState(sessionState, f.path);
    if (!known) {
      errors.push(`${f.path}: current file state cannot be verified; preserved`);
      continue;
    }
    let resolved: string;
    try {
      resolved = resolveWithinRoot(projectRoot, f.path);
    } catch {
      // intentional: report the unsafe path in the result without touching it.
      errors.push(`${f.path}: path escapes project root`);
      continue;
    }
    const current = await restoreTargetHash(resolved);
    if (current === undefined) {
      errors.push(`${f.path}: current file is unreadable or is not a regular file; preserved`);
    } else if (current !== hash) {
      externallyModified.push(f.path);
      errors.push(`${f.path}: changed outside this session; preserved`);
    }
  }
  if (errors.length > 0) return { restored, deleted, errors, externallyModified };

  for (const f of cp.files) {
    let resolved: string;
    try {
      resolved = resolveWithinRoot(projectRoot, f.path);
    } catch {
      // intentional: preserve the file and report the unsafe restore path.
      errors.push(`${f.path}: path escapes project root`);
      continue;
    }
    // Check again immediately before writing: another editor may have saved
    // after the batch preflight. A remaining check/use race is an OS limit.
    const expected = latestPostState(sessionState, f.path).hash;
    const current = await restoreTargetHash(resolved);
    if (current === undefined || current !== expected) {
      externallyModified.push(f.path);
      errors.push(`${f.path}: changed while rewinding; preserved`);
      continue;
    }
    try {
      if (f.content === null) {
        await fs.rm(resolved, { force: true });
        deleted.push(f.path);
      } else {
        await fs.mkdir(path.dirname(resolved), { recursive: true });
        // Atomic temp+rename (same primitive as write_file/edit_file): a crash
        // mid-restore can no longer leave a half-written file behind, and the
        // rename REPLACES a symlink at the target instead of following it —
        // the restore was the one write in the mutation surface that could
        // still be redirected through a swapped link. The replaced file's mode
        // is carried across so an executable script survives a rewind intact.
        let prevMode: number | undefined;
        try {
          prevMode = (await fs.stat(resolved)).mode & 0o777;
        } catch {
          // intentional: target absent (deleted-then-restored) — default 0600,
          // never the umask default, so restored secrets stay private.
          prevMode = 0o600;
        }
        await atomicWriteBuffer(resolved, f.content, { mode: prevMode });
        restored.push(f.path);
      }
    } catch (err: unknown) {
      errors.push(`${f.path}: ${getErrorMessage(err)}`);
    }
  }
  return { restored, deleted, errors, externallyModified };
}

/** `undefined` means unreadable, non-file, or too large to verify safely. */
async function restoreTargetHash(resolved: string): Promise<string | null | undefined> {
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(
      resolved,
      FS_CONSTANTS.O_RDONLY | FS_CONSTANTS.O_NONBLOCK | (FS_CONSTANTS.O_NOFOLLOW ?? 0)
    );
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > CHECKPOINT_FILE_MAX) return undefined;
    const data = Buffer.allocUnsafe(CHECKPOINT_FILE_MAX + 1);
    let bytes = 0;
    while (bytes < data.length) {
      const { bytesRead } = await handle.read(data, bytes, data.length - bytes, null);
      if (bytesRead === 0) break;
      bytes += bytesRead;
    }
    return bytes > CHECKPOINT_FILE_MAX ? undefined : hashBytes(data.subarray(0, bytes));
  } catch (err: unknown) {
    // intentional: a missing target has a null hash; other read failures are
    // unverifiable and must prevent rewind.
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    return undefined;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// /diff session review: what did this conversation change? The ring stores
// pre-change snapshots, so the OLDEST snapshot per path is the session
// baseline — diffing it against current disk shows everything the session
// did to that file, not just the last hop.
// ---------------------------------------------------------------------------

export interface SessionFileChange {
  path: string;
  kind: "modified" | "created" | "deleted";
  /** Unified diff vs the session baseline; null for deletions. */
  diff: string | null;
}

// (summarizeSessionChanges removed — C18/§2.8: dead export, no non-test caller.
// summarizeSessionChangesFromBaseline below is the live path.)

/**
 * Same review from a pre-built per-path baseline map — the session keeps a
 * first-seen baseline across ALL snapshots (not just the evicting ring), so
 * /diff and the goal debrief report every file this session touched even
 * after the checkpoint ring (CHECKPOINT_KEEP) dropped the earliest snapshots.
 */
export async function summarizeSessionChangesFromBaseline(
  projectRoot: string,
  baseline: ReadonlyMap<string, Buffer | null>
): Promise<SessionFileChange[]> {
  return diffBaseline(projectRoot, baseline);
}

async function diffBaseline(
  projectRoot: string,
  baseline: ReadonlyMap<string, Buffer | null>
): Promise<SessionFileChange[]> {
  const out: SessionFileChange[] = [];
  for (const [p, original] of baseline) {
    let abs: string;
    try {
      abs = resolveWithinRoot(projectRoot, p);
    } catch (err) {
      log.warn(`[checkpoints] Warning: path resolution failed for "${p}": ${getErrorMessage(err)}`);
      continue; // hostile path in a snapshot — never becomes a review vector
    }
    let current: Buffer | null = null;
    try {
      // Size-gate BEFORE reading: the baseline snapshot is capped but the live
      // file is not — a gigabyte log created mid-session would OOM /diff.
      const stat = await fs.stat(abs);
      if (stat.size > CHECKPOINT_FILE_MAX) continue;
      const buf = await fs.readFile(abs);
      // Binary files diff as garbage — skip like the read_file tool does.
      if (buf.includes(0)) continue;
      current = buf;
    } catch {
      current = null; // missing now = created-then-deleted, or deleted
    }
    if (original === null && current === null) continue;
    if (original !== null && current !== null && original.equals(current)) continue;
    const kind = original === null ? "created" : current === null ? "deleted" : "modified";
    const diff =
      kind === "deleted"
        ? null
        : createTwoFilesPatch(
            `a/${p}`,
            `b/${p}`,
            original === null ? "" : original.toString("utf8"),
            (current ?? Buffer.alloc(0)).toString("utf8"),
            undefined,
            undefined,
            { context: 2 }
          );
    out.push({ path: p, kind, diff });
  }
  return out;
}
