import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ---------------------------------------------------------------------------
// Atomic JSON writes (leaf module — no internal imports, so config, session
// store, and providers cache can all share it without import cycles).
// Crash mid-write must never leave a half-written credentials/settings/
// session/cache file behind for the lenient readers to misread.
// ---------------------------------------------------------------------------

/**
 * Single home-dir resolver (was copy-pasted across config/cache/store/mcp).
 * ANVIL_HOME relocates the data dir; resolved lazily because the env can be
 * set after modules import.
 */
export function anvilHome(): string {
  return process.env.ANVIL_HOME
    ? path.resolve(process.env.ANVIL_HOME)
    : path.join(os.homedir(), ".anvil");
}

/**
 * Serialize read-modify-write cycles across processes (credentials, settings).
 * `mkdir` is atomic: the winner holds the lock, losers spin briefly, and a
 * stale lock (crashed holder) fails open after ~100ms rather than deadlocking.
 * Best-effort by design — worst case is today's last-wins, never worse.
 */
export function withFileLockSync<T>(file: string, fn: () => T): T {
  const lockDir = `${file}.lock`;
  let held = false;
  for (let i = 0; i < 20; i++) {
    try {
      fs.mkdirSync(lockDir);
      held = true;
      break;
    } catch {
      // intentional: EEXIST means another process holds it — spin, then fail open.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
    }
  }
  try {
    return fn();
  } finally {
    if (held) {
      try {
        fs.rmdirSync(lockDir);
      } catch {
        // intentional: lock release is best-effort — a stale dir fails the next
        // holder open after its spin, never deadlocks it.
      }
    }
  }
}

/**
 * Write JSON atomically: temp file in the same directory (+ optional mode,
 * applied BEFORE the rename so there is no world-readable window) then
 * rename over the target. Throws on failure — callers decide policy.
 */
let tmpSeq = 0;
export function atomicWriteJson(file: string, data: unknown, opts?: { mode?: number }): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // Sequence suffix: two same-process writers to one target would otherwise
  // share a tmp name and race each other's rename (pid alone is not enough).
  const tmp = `${file}.tmp.${process.pid}.${tmpSeq++}`;
  let created = false;
  try {
    const fd = fs.openSync(tmp, "wx", opts?.mode);
    created = true;
    try {
      fs.writeFileSync(fd, JSON.stringify(data, null, 2), {
        encoding: "utf-8",
      });
    } finally {
      fs.closeSync(fd);
    }
    if (opts?.mode !== undefined) {
      fs.chmodSync(tmp, opts.mode);
    }
    fs.renameSync(tmp, file);
  } catch (err) {
    // Never leave the orphan tmp behind on a failed write.
    if (created) {
      try {
        fs.unlinkSync(tmp);
      } catch {
        // intentional: rename may already have moved the temporary file.
      }
    }
    throw err;
  }
}

/** Synchronous atomic text write for project memory's bounded read/modify/write. */
export function atomicWriteTextSync(file: string, content: string, opts?: { mode?: number }): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp.${process.pid}.${tmpSeq++}`;
  let created = false;
  try {
    const fd = fs.openSync(tmp, "wx", opts?.mode);
    created = true;
    try {
      fs.writeFileSync(fd, content, { encoding: "utf8" });
    } finally {
      fs.closeSync(fd);
    }
    if (opts?.mode !== undefined) fs.chmodSync(tmp, opts.mode);
    fs.renameSync(tmp, file);
  } catch (err) {
    if (created) {
      try {
        fs.unlinkSync(tmp);
      } catch {
        // intentional: rename may already have moved the temporary file.
      }
    }
    throw err;
  }
}

/**
 * Write bytes atomically: temp file in the same directory (+ optional mode,
 * applied before rename) then rename over the target. Same primitive as
 * `atomicWriteText` for arbitrary bytes — restores of binary snapshots need
 * byte-exact fidelity, and the rename REPLACES a symlink at the target rather
 * than following it, so no caller can be redirected through a swapped link.
 */
export async function atomicWriteBuffer(
  file: string,
  content: Buffer,
  opts?: { mode?: number; signal?: AbortSignal }
): Promise<void> {
  if (opts?.signal?.aborted) throw new Error("Aborted before writing");
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp.${process.pid}.${tmpSeq++}`;
  let created = false;
  try {
    const handle = await fs.promises.open(tmp, "wx", opts?.mode);
    created = true;
    try {
      await handle.writeFile(content);
      // Apply the requested bits through the owned handle, defeating umask
      // without following a substituted temporary-path symlink.
      if (opts?.mode !== undefined) await handle.chmod(opts.mode);
    } finally {
      await handle.close();
    }
    if (opts?.signal?.aborted) throw new Error("Aborted before renaming");
    await fs.promises.rename(tmp, file);
  } catch (err) {
    if (created) {
      try {
        await fs.promises.unlink(tmp);
      } catch {
        // intentional: rename may already have moved the owned temporary file.
      }
    }
    throw err;
  }
}

/**
 * Write text atomically: temp file in the same directory (+ optional mode,
 * applied before rename) then rename over the target.
 */
export async function atomicWriteText(
  file: string,
  content: string,
  opts?: { mode?: number; signal?: AbortSignal }
): Promise<void> {
  await atomicWriteBuffer(file, Buffer.from(content, "utf8"), opts);
}
