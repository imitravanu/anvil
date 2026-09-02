import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { deleteSession, listSessions, loadSession, renameSession, saveSession } from "../store.js";
import { StoredSession } from "../types.js";

let dir: string;

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "anvil-sessions-"));
});
afterAll(() => fs.rm(dir, { recursive: true, force: true }));

function makeStored(id: string, title: string, updatedAt: string): StoredSession {
  return {
    metadata: {
      id,
      title,
      providerId: "gemini",
      model: "gemini-3.6-flash",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt,
    },
    history: [{ role: "user", content: [{ type: "text", text: `hello ${id}` }] }],
  };
}

describe("session store", () => {
  it("save → load round-trip preserves content exactly", () => {
    const stored = makeStored("s1", "Round trip", "2026-01-02T00:00:00.000Z");
    saveSession(stored, dir);
    expect(loadSession("s1", dir)).toEqual(stored);
  });

  it("listSessions sorts by most-recently-updated", () => {
    saveSession(makeStored("old", "Old", "2026-01-01T00:00:00.000Z"), dir);
    saveSession(makeStored("new", "New", "2026-01-03T00:00:00.000Z"), dir);
    saveSession(makeStored("mid", "Mid", "2026-01-02T00:00:00.000Z"), dir);
    // s1.json from the round-trip test also exists here; assert relative order only
    const ids = listSessions(dir).map((m) => m.id);
    expect(ids.indexOf("new")).toBeLessThan(ids.indexOf("mid"));
    expect(ids.indexOf("mid")).toBeLessThan(ids.indexOf("old"));
  });

  it("a corrupt JSON file is silently skipped, not thrown", async () => {
    await fs.writeFile(path.join(dir, "corrupt.json"), "{not valid json!!", "utf-8");
    expect(() => listSessions(dir)).not.toThrow();
    expect(listSessions(dir).map((m) => m.id)).not.toContain("corrupt");
  });

  it("loadSession returns null for missing/corrupt files", async () => {
    expect(loadSession("does-not-exist", dir)).toBeNull();
    expect(loadSession("corrupt", dir)).toBeNull();
  });

  it("renameSession updates the title and bump updatedAt", () => {
    saveSession(makeStored("r1", "Before", "2026-01-01T00:00:00.000Z"), dir);
    renameSession("r1", "After", dir);
    const stored = loadSession("r1", dir);
    expect(stored?.metadata.title).toBe("After");
    expect(stored?.metadata.updatedAt).not.toBe("2026-01-01T00:00:00.000Z");
  });

  it("deleteSession removes the file", () => {
    saveSession(makeStored("d1", "Doomed", "2026-01-01T00:00:00.000Z"), dir);
    deleteSession("d1", dir);
    expect(loadSession("d1", dir)).toBeNull();
  });
});