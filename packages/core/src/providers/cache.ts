import fs from "node:fs";
import path from "node:path";
import { anvilHome, atomicWriteJson } from "../atomicWrite.js";
import type { ModelInfo } from "./types.js";
import { getErrorMessage } from "../errors.js";
import { log } from "../logger.js";

const MODELS_CACHE_PATH = (): string => path.join(anvilHome(), "models-cache.json");

/**
 * Cache v2 — the truth format: versioned, timestamped, per-source.
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
    // intentional: missing/corrupt cache reads as empty — never throws at boot.
  }
  return { version: 2, syncedAt: null, sources: {} };
}

export function saveModelsCacheV2(cache: ModelsCacheV2): void {
  try {
    atomicWriteJson(MODELS_CACHE_PATH(), cache);
  } catch (err) {
    log.warn(`[cache] Warning: failed to save models cache: ${getErrorMessage(err)}`);
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

// --- v1 flat-list API, kept for backward compatibility. ---

export function loadModelsCache(): ModelInfo[] {
  return collectModelsFromCache(loadModelsCacheV2());
}

/**
 * v1 flat-list write, kept for backward compatibility. It MERGES into the v2
 * cache instead of replacing it: the old body rewrote the whole file as
 * `{ version: 2, syncedAt: null, sources: { legacy } }`, so a single v1 write
 * destroyed every other source a sync had collected AND cleared the freshness
 * stamp those models were carried in under.
 */
export function saveModelsCache(models: ModelInfo[]): void {
  const cache = loadModelsCacheV2();
  saveModelsCacheV2({
    version: 2,
    syncedAt: cache.syncedAt,
    sources: { ...cache.sources, legacy: models },
  });
}
