import fs from "node:fs";
import path from "node:path";
import { anvilHome, atomicWriteJson } from "../atomicWrite.js";
import { CHECKPOINT_KEEP, type Checkpoint } from "./checkpoints.js";

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

export function saveCheckpoints(
  sessionId: string,
  checkpoints: readonly Checkpoint[],
  dir: string = checkpointsDir()
): void {
  if (!SAFE_ID_RE.test(sessionId) || checkpoints.length === 0) return;
  const serialized: SerializedCheckpoint[] = checkpoints.map((cp) => ({
    id: cp.id,
    ts: cp.ts,
    skipped: cp.skipped,
    files: cp.files.map((f) => ({
      path: f.path,
      content: f.content === null ? null : f.content.toString("base64"),
    })),
  }));
  try {
    atomicWriteJson(path.join(dir, `${sessionId}.json`), { version: 1, checkpoints: serialized }, { mode: 0o600 });
  } catch {
    // persistence is best-effort: an in-memory ring still covers this session
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
        files: c.files
          .filter((f): f is { path: string; content: string | null } =>
            typeof f === "object" && f !== null && typeof (f as { path?: unknown }).path === "string")
          .map((f) => ({
            path: f.path,
            content: f.content === null ? null : Buffer.from(f.content, "base64"),
          })),
      });
    }
    return out.slice(-CHECKPOINT_KEEP);
  } catch {
    return []; // missing/corrupt file = no history, never a crash
  }
}
