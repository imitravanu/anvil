import {
  capCheckpoints,
  checkpointMeta,
  fingerprintPath,
  restoreCheckpoint,
  summarizeSessionChangesFromBaseline,
  takeSnapshot,
  type Checkpoint,
  type CheckpointMeta,
  type FileSnapshot,
  type SessionFileChange,
} from "./checkpoints.js";
import { loadCheckpoints, saveCheckpointsAsync } from "./checkpointStore.js";
import { BASELINE_MAX_BYTES, BASELINE_MAX_PATHS } from "../config/constants.js";
import type { RunLedgerEntry } from "./ledger.js";

export interface RewindResult {
  ok: boolean;
  restored: string[];
  deleted: string[];
  errors: string[];
  /** Targets edited on disk outside this session — restored anyway, reported. */
  externallyModified: string[];
  message: string;
}

export interface RewindRingDeps {
  projectRoot: string;
  sessionId: string;
  /** Ledger seam: the ring records checkpoint_created / checkpoint_merged / rewind. */
  recordLedger: (entry: Omit<RunLedgerEntry, "seq" | "ts">) => void;
}

/**
 * The session's rewind state: a persisted, ring-bounded stack of pre-mutation
 * file snapshots plus a ring-independent review baseline (first-seen content
 * per path, so `/diff` and the goal debrief keep reporting every touched file
 * even after the ring evicts). Extracted from `AgentSession`; the session keeps
 * only the loop-specific part — turning pending tool calls into paths and
 * succeeded outcomes into a committed checkpoint.
 */
export class RewindRing {
  private checkpoints: Checkpoint[] = [];
  private seq = 0;
  private readonly baselineByPath = new Map<string, Buffer | null>();
  private baselineBytes = 0;
  // Coverage honesty: how much the bounded stores have dropped. The UI warns
  // that /diff (baseline) or /rewind depth (ring) is no longer complete rather
  // than presenting a silently partial review as whole.
  private baselineDropped = 0;
  private ringDropped = 0;

  constructor(private readonly deps: RewindRingDeps) {
    // Persistent rewind ring: resumed sessions keep their undo history.
    this.checkpoints = loadCheckpoints(deps.sessionId);
    this.seq = this.checkpoints.reduce((m, cp) => Math.max(m, cp.id), 0);
    // Rebuild the review baseline from whatever the persisted ring holds
    // (first-seen per path) — the best available after a restart.
    for (const cp of this.checkpoints) this.recordBaseline(cp);
  }

  /** Metadata view for the UI listing (contents never leave the session). */
  listMeta(): CheckpointMeta[] {
    return this.checkpoints.map(checkpointMeta);
  }

  /**
   * Hand over the ring and empty it. Internal seam for sub-agent delegation
   * (the parent merges them into its own ring) — not part of the UI surface.
   */
  drain(): Checkpoint[] {
    const drained = [...this.checkpoints];
    this.checkpoints = [];
    return drained;
  }

  /** Merge sub-agent checkpoints into the ring with fresh ids. */
  async merge(sub: readonly Checkpoint[]): Promise<void> {
    if (sub.length === 0) return;
    for (const cp of sub) {
      this.seq += 1;
      this.addCheckpoint({ ...cp, id: this.seq });
      this.recordBaseline({ ...cp, id: this.seq });
    }
    await this.persist();
    this.deps.recordLedger({ eventType: "checkpoint_merged", outcome: "ok", elapsedMs: 0 });
  }

  /** Snapshot `paths` with the next id; null when nothing readable was found. */
  async take(paths: readonly string[]): Promise<Checkpoint | null> {
    const cp = await takeSnapshot(this.deps.projectRoot, this.seq + 1, [...paths]);
    if (cp.files.length > 0) {
      this.recordBaseline(cp);
      return cp;
    }
    return null;
  }

  /**
   * Commit a pending snapshot once its mutations have settled, keeping only the
   * paths whose calls actually succeeded (S1.3: a denied/refused/failed call did
   * not change its file, so its pre-state must not claim undo coverage).
   * Post-mutation fingerprints are taken now — the succeeded calls are the only
   * writers of these paths in this batch, so what is on disk IS the state this
   * session left behind. Returns null when nothing succeeded.
   */
  async commit(pending: Checkpoint, succeededPaths: ReadonlySet<string>): Promise<Checkpoint | null> {
    const committedFiles: FileSnapshot[] = await Promise.all(
      pending.files
        .filter((f) => succeededPaths.has(f.path))
        .map(async (f) => ({ ...f, postHash: await fingerprintPath(this.deps.projectRoot, f.path) }))
    );
    if (committedFiles.length === 0) return null;
    const committed: Checkpoint = { ...pending, files: committedFiles };
    this.seq = pending.id;
    this.addCheckpoint(committed);
    await this.persist();
    this.deps.recordLedger({ eventType: "checkpoint_created", outcome: "ok", elapsedMs: 0 });
    return committed;
  }

  /**
   * Restore a checkpoint's files (originals written back, creations deleted).
   * The explicit call IS the consent — no permission prompt — and the restore is
   * ledger-recorded. Never creates a checkpoint itself.
   */
  async rewind(id: number): Promise<RewindResult> {
    const cp = this.checkpoints.find((c) => c.id === id);
    if (!cp) {
      this.deps.recordLedger({ eventType: "rewind", outcome: "error", elapsedMs: 0 });
      return {
        ok: false,
        restored: [],
        deleted: [],
        errors: [`No checkpoint #${id} in this session.`],
        externallyModified: [],
        message: `No checkpoint #${id} in this session.`,
      };
    }
    const startedAt = Date.now();
    // The whole ring, not just this checkpoint: a file the session wrote AFTER
    // the checkpoint being restored has drifted by the session's own hand, and
    // must not be reported as an outside edit.
    const result = await restoreCheckpoint(this.deps.projectRoot, cp, this.checkpoints);
    const ok = result.errors.length === 0;
    this.deps.recordLedger({ eventType: "rewind", outcome: ok ? "ok" : "error", elapsedMs: Date.now() - startedAt });
    const parts: string[] = [];
    if (result.restored.length > 0) parts.push(`restored ${result.restored.length}: ${result.restored.join(", ")}`);
    if (result.deleted.length > 0) parts.push(`deleted ${result.deleted.length} created: ${result.deleted.join(", ")}`);
    if (result.errors.length > 0) parts.push(`errors: ${result.errors.join("; ")}`);
    return { ...result, ok, message: parts.length > 0 ? parts.join(" ") : "Checkpoint was empty — nothing to restore." };
  }

  /**
   * `/diff` review: file changes this session made, diffed against the
   * pre-change baseline. Uses the ring-independent baseline so capped
   * checkpoint eviction never hides changes.
   */
  summarizeChanges(): Promise<SessionFileChange[]> {
    return summarizeSessionChangesFromBaseline(this.deps.projectRoot, this.baselineByPath);
  }

  /** Paths that aged out of the bounded review baseline (BASELINE_MAX_*). */
  get baselineDroppedPaths(): number {
    return this.baselineDropped;
  }

  /** Checkpoints evicted by the ring cap (CHECKPOINT_KEEP) — /rewind undo depth. */
  get ringDroppedCheckpoints(): number {
    return this.ringDropped;
  }

  /** Append with ring capping, counting what the cap evicted. */
  private addCheckpoint(cp: Checkpoint): void {
    const next = capCheckpoints([...this.checkpoints, cp]);
    const dropped = this.checkpoints.length + 1 - next.length;
    if (dropped > 0) this.ringDropped += dropped;
    this.checkpoints = next;
  }

  /** Best-effort persist of the ring. Awaited to avoid data loss on crash. */
  private async persist(): Promise<void> {
    await saveCheckpointsAsync(this.deps.sessionId, this.checkpoints);
  }

  /**
   * First-seen-per-path merge into the review baseline. A file previously
   * snapped (by a direct write or a merged sub-agent) keeps its ORIGINAL
   * content — the oldest snapshot per path is the session baseline. Bounded
   * by BASELINE_MAX_PATHS / BASELINE_MAX_BYTES (oldest-seen evicted first):
   * eviction only narrows /diff coverage, it never corrupts history.
   */
  private recordBaseline(cp: Checkpoint): void {
    for (const f of cp.files) {
      if (this.baselineByPath.has(f.path)) continue;
      this.baselineByPath.set(f.path, f.content);
      this.baselineBytes += f.content?.length ?? 0;
      while (
        this.baselineByPath.size > BASELINE_MAX_PATHS ||
        this.baselineBytes > BASELINE_MAX_BYTES
      ) {
        const oldest = this.baselineByPath.keys().next();
        if (oldest.done) break;
        const dropped = this.baselineByPath.get(oldest.value);
        this.baselineBytes -= dropped?.length ?? 0;
        this.baselineByPath.delete(oldest.value);
        this.baselineDropped += 1;
      }
    }
  }
}
