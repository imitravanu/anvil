import fs from "node:fs";
import path from "node:path";
import { anvilHome, atomicWriteJson } from "../atomicWrite.js";
import { StoredSession, SessionMetadata } from "./types.js";

// Default sessions dir honors ANVIL_HOME (like the models cache) so tests and
// relocated installs never touch the real ~/.anvil/sessions. Resolved lazily
// because the env can be set after import. Callers may still pass an explicit
// dir override, which always wins.
const SESSIONS_DIR = (): string => path.join(anvilHome(), "sessions");

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

// Session ids are UUIDs we generate, but load/delete also accept CLI input —
// never let `..` or `/` reach path.join (path traversal into/over other files).
const SAFE_ID_RE = /^[A-Za-z0-9-_]+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStoredSession(v: unknown): v is StoredSession {
  if (!isRecord(v) || !isRecord(v.metadata) || !Array.isArray(v.history)) return false;
  if (typeof v.metadata.id !== "string") return false;
  // Deep guard: a corrupt entry (null, wrong role, missing content) must fail
  // lookup, not crash restore when HistoryStore dereferences role/content.
  for (const entry of v.history) {
    if (!isRecord(entry) || (entry.role !== "user" && entry.role !== "assistant")) return false;
    if (!Array.isArray(entry.content)) return false;
    for (const part of entry.content) {
      if (!isRecord(part)) return false;
      if (part.type === "text") {
        if (typeof part.text !== "string") return false;
      } else if (part.type === "image") {
        if (typeof part.mediaType !== "string" || typeof part.data !== "string") return false;
      } else if (part.type === "tool_call") {
        if (!isRecord(part.call) || typeof part.call.id !== "string" || typeof part.call.name !== "string") return false;
      } else if (part.type === "tool_result") {
        if (!isRecord(part.result) || typeof part.result.toolCallId !== "string" || typeof part.result.content !== "string") return false;
        if (part.result.isError !== undefined && typeof part.result.isError !== "boolean") return false;
      } else {
        return false;
      }
    }
  }
  return true;
}

// All functions take an optional directory override so tests can run against a
// temp dir instead of the real sessions dir.
export function sessionsDir(dir?: string): string {
  return dir ?? SESSIONS_DIR();
}
export function saveSession(session: StoredSession, dir: string = SESSIONS_DIR()): void {
  if (!SAFE_ID_RE.test(session.metadata.id)) {
    throw new Error(`Refusing to save session with unsafe id: ${session.metadata.id}`);
  }
  // Conversations can contain credentials in user text and tool output.
  atomicWriteJson(path.join(dir, `${session.metadata.id}.json`), session, { mode: 0o600 });
}

export function loadSession(id: string, dir: string = SESSIONS_DIR()): StoredSession | null {
  if (!SAFE_ID_RE.test(id)) return null;
  const file = path.join(dir, `${id}.json`);
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(file, "utf-8"));
    return isStoredSession(raw) ? raw : null;
  } catch {
    // intentional: a missing or corrupt session file is a lookup miss — the
    // sessions dir is user-facing and a bad file must not crash the picker.
    return null;
  }
}

export function listSessions(dir: string = SESSIONS_DIR()): SessionMetadata[] {
  ensureDir(dir);
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        const raw: unknown = JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8"));
        // Shape-checked: a corrupt-but-parseable file (or one missing
        // updatedAt) must never brick the whole list downstream.
        if (!isStoredSession(raw)) return null;
        return raw.metadata;
      } catch {
        // intentional: corrupt/partial file from a crash mid-write — skip, never throw.
        return null;
      }
    })
    .filter((m): m is SessionMetadata => m !== null)
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
}

export function renameSession(id: string, title: string, dir: string = SESSIONS_DIR()): void {
  const stored = loadSession(id, dir);
  if (!stored) return;
  stored.metadata.title = title;
  stored.metadata.updatedAt = new Date().toISOString();
  saveSession(stored, dir);
}

export function deleteSession(id: string, dir: string = SESSIONS_DIR()): void {
  if (!SAFE_ID_RE.test(id)) return;
  const file = path.join(dir, `${id}.json`);
  fs.rmSync(file, { force: true });
}
