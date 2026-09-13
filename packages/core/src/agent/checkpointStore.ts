import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { anvilHome } from "../atomicWrite.js";
import { CHECKPOINT_KEEP, type Checkpoint } from "./checkpoints.js";
import { getErrorMessage } from "../errors.js";

// ---------------------------------------------------------------------------
// Persistent checkpoint ring: /rewind previously forgot every snapshot when
// the app exited, which made it useless across restarts — exactly when you
// want it. One JSON file per session under ANVIL_HOME/checkpoints; contents
// are raw file bytes (base64) from the project, so the file is 0600 and
// lives in the same trust domain as session files, which already store the
// full conversation.
// ---------------------------------------------------------------------------

const checkpointsDir = (): string => path.join(anvilHome(), "checkpoints");
const SAFE_ID_RE = /^[A-Za-z0-9-_]+$/; // same contract as the session store

interface SerializedCheckpoint {
  id: number;
  ts: string;
  skipped: number;
  files: { path: string; content: string | null }[]; // content = base64, null = created by the agent
}

function serializeCheckpoints(checkpoints: readonly Checkpoint[]): SerializedCheckpoint[] {
  return checkpoints.map((cp) => ({
    id: cp.id,
    ts: cp.ts,
    skipped: cp.skipped,
    files: cp.files.map((f) => ({
      path: f.path,
      content: f.content === null ? null : f.content.toString("base64"),
    })),
  }));
}

let tmpSeq = 0;

export async function saveCheckpointsAsync(
  sessionId: string,
  checkpoints: readonly Checkpoint[],
  dir: string = checkpointsDir()
): Promise<void> {
  if (!SAFE_ID_RE.test(sessionId)) return;
  const targetPath = path.join(dir, `${sessionId}.json`);
  // An emptied ring (all rewound / drained) must clear the persisted file too,
  // or the next resume resurrects checkpoints the user already used up.
  if (checkpoints.length === 0) {
    try {
      await fsPromises.unlink(targetPath);
    } catch {
      // missing file is the desired end state anyway
    }
    return;
  }
  const serialized = serializeCheckpoints(checkpoints);
  const tmp = `${targetPath}.tmp.${process.pid}.${Date.now()}.${++tmpSeq}`;
  try {
    await fsPromises.mkdir(path.dirname(targetPath), { recursive: true });
    await fsPromises.writeFile(tmp, JSON.stringify({ version: 1, checkpoints: serialized }, null, 2), "utf-8");
    await fsPromises.chmod(tmp, 0o600);
    await fsPromises.rename(tmp, targetPath);
  } catch (err) {
    // persistence is best-effort: an in-memory ring still covers this session
    console.error(`[anvil] Warning: failed to save checkpoints for session ${sessionId}: ${getErrorMessage(err)}`);
  }
}

export function loadCheckpoints(sessionId: string, dir: string = checkpointsDir()): Checkpoint[] {
  if (!SAFE_ID_RE.test(sessionId)) return [];
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(path.join(dir, `${sessionId}.json`), "utf-8"));
    if (typeof raw !== "object" || raw === null || !Array.isArray((raw as { checkpoints?: unknown }).checkpoints)) {
      return [];
    }
    const out: Checkpoint[] = [];
    for (const cp of (raw as { checkpoints: unknown[] }).checkpoints) {
      if (typeof cp !== "object" || cp === null) continue;
      const c = cp as Partial<SerializedCheckpoint>;
      if (typeof c.id !== "number" || typeof c.ts !== "string" || !Array.isArray(c.files)) continue;
      out.push({
        id: c.id,
        ts: c.ts,
        skipped: typeof c.skipped === "number" ? c.skipped : 0,
        // Validate content per entry: one malformed entry must not throw out
        // of Buffer.from and discard the whole session's checkpoint history.
        files: c.files
          .filter(
            (f): f is { path: string; content: string | null } =>
              typeof f === "object" &&
              f !== null &&
              typeof (f as { path?: unknown }).path === "string" &&
              ((f as { content?: unknown }).content === null ||
                typeof (f as { content?: unknown }).content === "string")
          )
          .map((f) => ({
            path: f.path,
            content: f.content === null ? null : Buffer.from(f.content, "base64"),
          })),
      });
    }
    return out.slice(-CHECKPOINT_KEEP);
  } catch (err) {
    const filePath = path.join(dir, `${sessionId}.json`);
    if (fs.existsSync(filePath)) {
      console.error(`[anvil] Warning: failed to load checkpoints for session ${sessionId}: ${getErrorMessage(err)}`);
    }
    return []; // missing/corrupt file = no history, never a crash
  }
}
