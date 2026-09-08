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
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
    if (opts?.mode !== undefined) {
      fs.chmodSync(tmp, opts.mode);
    }
    fs.renameSync(tmp, file);
  } catch (err) {
    // Never leave the orphan tmp behind on a failed write.
    try {
      fs.unlinkSync(tmp);
    } catch {
      // already gone — nothing to clean
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
  if (opts?.signal?.aborted) throw new Error("Aborted before writing");
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp.${process.pid}.${tmpSeq++}`;
  try {
    if (opts?.mode !== undefined) {
      await fs.promises.writeFile(tmp, content, { encoding: "utf8", mode: opts.mode });
    } else {
      await fs.promises.writeFile(tmp, content, "utf8");
    }
    if (opts?.signal?.aborted) throw new Error("Aborted before renaming");
    await fs.promises.rename(tmp, file);
  } catch (err) {
    try {
      await fs.promises.unlink(tmp);
    } catch {
      // already gone
    }
    throw err;
  }
}
