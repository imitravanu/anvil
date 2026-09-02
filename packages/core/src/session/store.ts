import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { StoredSession, SessionMetadata } from "./types.js";

const SESSIONS_DIR = path.join(os.homedir(), ".anvil", "sessions");

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

// All functions take an optional directory override so tests can run against a
// temp dir instead of the real ~/.anvil/sessions.
export function saveSession(session: StoredSession, dir: string = SESSIONS_DIR): void {
  ensureDir(dir);
  const file = path.join(dir, `${session.metadata.id}.json`);
  fs.writeFileSync(file, JSON.stringify(session, null, 2), "utf-8");
}

export function loadSession(id: string, dir: string = SESSIONS_DIR): StoredSession | null {
  const file = path.join(dir, `${id}.json`);
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return null;
  }
}

export function listSessions(dir: string = SESSIONS_DIR): SessionMetadata[] {
  ensureDir(dir);
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        const stored: StoredSession = JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8"));
        return stored.metadata;
      } catch {
        return null; // corrupt/partial file from a crash mid-write — skip, never throw
      }
    })
    .filter((m): m is SessionMetadata => m !== null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function renameSession(id: string, title: string, dir: string = SESSIONS_DIR): void {
  const stored = loadSession(id, dir);
  if (!stored) return;
  stored.metadata.title = title;
  stored.metadata.updatedAt = new Date().toISOString();
  saveSession(stored, dir);
}

export function deleteSession(id: string, dir: string = SESSIONS_DIR): void {
  const file = path.join(dir, `${id}.json`);
  fs.rmSync(file, { force: true });
}