import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ModelInfo } from "../types.js";
import {
  collectModelsFromCache,
  isModelsCacheFresh,
  loadModelsCache,
  loadModelsCacheV2,
  saveModelsCacheV2,
} from "../cache.js";

const model = (id: string, providerId: string): ModelInfo => ({
  id,
  providerId,
  displayName: `${id} (Free)`,
  contextWindow: 128_000,
  supportsTools: true,
  supportsVision: false,
  isFree: true,
});

describe("Phase 8 (B) — cache v2", () => {
  let tmp: string;
  let cachePath: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-p8c-"));
    process.env.ANVIL_HOME = tmp;
    cachePath = path.join(tmp, "models-cache.json");
  });
  afterEach(() => {
    delete process.env.ANVIL_HOME;
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("B5a: v2 round-trips and freshness is honest", () => {
    const now = new Date().toISOString();
    saveModelsCacheV2({ version: 2, syncedAt: now, sources: { openrouter: [model("a", "openrouter")] } });
    const loaded = loadModelsCacheV2();
    expect(loaded.version).toBe(2);
    expect(loaded.syncedAt).toBe(now);
    expect(loaded.sources.openrouter).toHaveLength(1);
    expect(isModelsCacheFresh(10 * 60 * 1000)).toBe(true);
  });

  it("B5b: an old syncedAt is reported stale", () => {
    saveModelsCacheV2({
      version: 2,
      syncedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      sources: {},
    });
    expect(isModelsCacheFresh(10 * 60 * 1000)).toBe(false);
  });

  it("B5c: a legacy v1 array migrates with NO freshness stamp", () => {
    fs.writeFileSync(cachePath, JSON.stringify([model("legacy-a", "groq")]), "utf-8");
    const loaded = loadModelsCacheV2();
    expect(loaded.sources.legacy).toHaveLength(1);
    expect(loaded.syncedAt).toBeNull();
    expect(isModelsCacheFresh(10 * 60 * 1000)).toBe(false);
    expect(loadModelsCache().map((m) => m.id)).toContain("legacy-a");
  });

  it("B5d: corrupt or missing file is empty, never thrown", () => {
    fs.writeFileSync(cachePath, "{ not json", "utf-8");
    expect(loadModelsCacheV2().sources).toEqual({});
    expect(isModelsCacheFresh(1000)).toBe(false);
    fs.rmSync(cachePath, { force: true });
    expect(loadModelsCacheV2().sources).toEqual({});
  });

  it("collects and de-duplicates across sources", () => {
    saveModelsCacheV2({
      version: 2,
      syncedAt: new Date().toISOString(),
      sources: {
        openrouter: [model("dup", "openrouter")],
        legacy: [model("dup", "openrouter"), model("other", "groq")],
      },
    });
    const flat = collectModelsFromCache(loadModelsCacheV2());
    expect(flat.filter((m) => m.id === "dup").length).toBe(1);
    expect(flat.some((m) => m.id === "other")).toBe(true);
  });
});