import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { atomicWriteJson } from "../atomicWrite.js";
import type { ModelInfo } from "./types.js";

// ANVIL_HOME lets tests (and future users) relocate the data dir; it must be
// resolved lazily because the env can be set after this module is imported.
function anvilHome(): string {
  return process.env.ANVIL_HOME
    ? path.resolve(process.env.ANVIL_HOME)
    : path.join(os.homedir(), ".anvil");
}

const MODELS_CACHE_PATH = (): string => path.join(anvilHome(), "models-cache.json");

/**
 * Cache v2 — the Phase 8 (B) truth format: versioned, timestamped, per-source.
 * `isModelsCacheFresh` answers "how old is this data" without hiding staleness.
 */
export interface ModelsCacheV2 {
  version: 2;
  syncedAt: string | null; // ISO timestamp of the last successful sync, or null
  sources: Record<string, ModelInfo[]>;
}

export function loadModelsCacheV2(): ModelsCacheV2 {
  try {
    const raw = JSON.parse(fs.readFileSync(MODELS_CACHE_PATH(), "utf-8"));
    if (raw && raw.version === 2 && typeof raw.sources === "object" && raw.sources !== null && !Array.isArray(raw.sources)) {
      return {
        version: 2,
        syncedAt: typeof raw.syncedAt === "string" ? raw.syncedAt : null,
        sources: raw.sources as Record<string, ModelInfo[]>,
      };
    }
    // Legacy v1 (bare ModelInfo[] array) — migrate, but with NO freshness stamp.
    if (Array.isArray(raw)) {
      return { version: 2, syncedAt: null, sources: { legacy: raw as ModelInfo[] } };
    }
  } catch {
    // missing / corrupt → empty, never throw
  }
  return { version: 2, syncedAt: null, sources: {} };
}

export function saveModelsCacheV2(cache: ModelsCacheV2): void {
  try {
    atomicWriteJson(MODELS_CACHE_PATH(), cache);
  } catch {
    // Non-fatal
  }
}

/** True when a v2 cache has a syncedAt no older than ttlMs. */
export function isModelsCacheFresh(ttlMs: number): boolean {
  const cache = loadModelsCacheV2();
  if (!cache.syncedAt) return false;
  const at = Date.parse(cache.syncedAt);
  if (Number.isNaN(at)) return false;
  return Date.now() - at <= ttlMs;
}

/** Flatten every source's models into one de-duplicated list (by id+provider). */
export function collectModelsFromCache(cache: ModelsCacheV2): ModelInfo[] {
  const out: ModelInfo[] = [];
  const seen = new Set<string>();
  for (const id of Object.keys(cache.sources)) {
    const list = cache.sources[id];
    if (!Array.isArray(list)) continue;
    for (const m of list) {
      if (!m || typeof m !== "object" || !m.id || !m.providerId) continue;
      const key = `${m.providerId}:${m.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(m);
    }
  }
  return out;
}

// --- Phase 7 legacy API (v1 flat list) kept for backward compatibility. ---

export function loadModelsCache(): ModelInfo[] {
  return collectModelsFromCache(loadModelsCacheV2());
}

export function saveModelsCache(models: ModelInfo[]): void {
  saveModelsCacheV2({ version: 2, syncedAt: null, sources: { legacy: models } });
}
