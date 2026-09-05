import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Atomic JSON writes (leaf module — no internal imports, so config, session
// store, and providers cache can all share it without import cycles).
// Crash mid-write must never leave a half-written credentials/settings/
// session/cache file behind for the lenient readers to misread.
// ---------------------------------------------------------------------------

/**
 * Write JSON atomically: temp file in the same directory (+ optional mode,
 * applied BEFORE the rename so there is no world-readable window) then
 * rename over the target. Throws on failure — callers decide policy.
 */
export function atomicWriteJson(file: string, data: unknown, opts?: { mode?: number }): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  if (opts?.mode !== undefined) {
    fs.chmodSync(tmp, opts.mode);
  }
  fs.renameSync(tmp, file);
}
