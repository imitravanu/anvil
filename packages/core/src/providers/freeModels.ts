import { ModelInfo } from "./types.js";
import { MODEL_REGISTRY, registerModel } from "./registry.js";
import { loadModelsCacheV2, saveModelsCacheV2, ModelsCacheV2 } from "./cache.js";

// ---------------------------------------------------------------------------
// Phase 8 (B): one owner for free-model discovery. Any provider that publishes
// a free-model list implements FreeModelSource; OpenRouter is the sole ship.
// ---------------------------------------------------------------------------

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
export const DEFAULT_SYNC_TTL_MS = 10 * 60 * 1000; // 10 minutes
const REFERER = "https://github.com/mitravanu/anvil";
const TITLE = "Anvil";

export interface FreeModelSource {
  id: string;
  fetchFreeModels(apiKey?: string): Promise<ModelInfo[]>;
}

export interface SourceResult {
  sourceId: string;
  ok: boolean;
  count: number;
  newlyFree: string[];
  noLongerFree: string[];
  error?: string;
}

export interface SyncReport {
  refreshedAt: string | null; // ISO of the data's actual age, or null if nothing refreshed
  results: SourceResult[];
  errors: string[]; // every failure, never swallowed
}

/** OpenRouter deliberately mimics chat-completions; its /models endpoint is public. */
export async function fetchOpenRouterFreeModels(apiKey?: string): Promise<ModelInfo[]> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const headers: Record<string, string> = { "HTTP-Referer": REFERER, "X-Title": TITLE };
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

    const res = await fetch(`${OPENROUTER_BASE_URL}/models`, { signal: controller.signal, headers });
    clearTimeout(timer);
    if (!res.ok) return [];

    const json = (await res.json()) as { data?: Array<any> };
    if (!Array.isArray(json.data)) return [];

    const freeModels: ModelInfo[] = [];
    for (const m of json.data) {
      const isZeroPrice = m.pricing?.prompt === "0" && m.pricing?.completion === "0";
      const isFreeId =
        typeof m.id === "string" && (m.id.endsWith(":free") || m.id === "openrouter/free");
      if (!isZeroPrice && !isFreeId) continue;

      const supportsTools = Array.isArray(m.supported_parameters) && m.supported_parameters.includes("tools");
      const supportsVision =
        typeof m.architecture?.modality === "string" && m.architecture.modality.includes("image");
      const rawName = typeof m.name === "string" ? m.name : m.id;
      const cleanName = rawName.replace(/\s*\(free\)\s*$/i, "").trim();

      freeModels.push({
        id: m.id,
        providerId: "openrouter",
        displayName: `${cleanName} (Free)`,
        contextWindow: typeof m.context_length === "number" ? m.context_length : 128_000,
        supportsTools,
        supportsVision,
        isFree: true,
      });
    }

    freeModels.sort((a, b) => {
      if (a.id === "openrouter/free") return -1;
      if (b.id === "openrouter/free") return 1;
      if (a.supportsTools !== b.supportsTools) return a.supportsTools ? -1 : 1;
      return a.displayName.localeCompare(b.displayName);
    });
    return freeModels;
  } catch {
    return [];
  }
}

export function createOpenRouterFreeSource(): FreeModelSource {
  return { id: "openrouter", fetchFreeModels: (key) => fetchOpenRouterFreeModels(key) };
}

// --- Recorded 429/rate-limit health (record only — NO backoff in this phase). ---

const rateLimited = new Map<string, Set<string>>(); // sourceId -> model ids

export function noteRateLimited(sourceId: string, modelId: string): void {
  let set = rateLimited.get(sourceId);
  if (!set) {
    set = new Set();
    rateLimited.set(sourceId, set);
  }
  set.add(modelId);
}

export function isRateLimited(sourceId: string, modelId: string): boolean {
  return rateLimited.get(sourceId)?.has(modelId) ?? false;
}

export function getRateLimitedModels(): Readonly<Record<string, readonly string[]>> {
  const out: Record<string, readonly string[]> = {};
  for (const [source, set] of rateLimited) out[source] = [...set];
  return out;
}

/** Loose detector for rate-limit/quota errors so the agent loop can RECORD them. */
export function isRateLimitMessage(message: string): boolean {
  return /\b429\b|rate\s*[- ]?limit|quota|too many requests/i.test(message);
}
// --- The single owner of free-model sync (B.2). ---

// Module-level state keeps one in-flight promise + one freshness clock per
// process. Seeded from the persisted v2 cache so a boot inside the TTL does not
// hammer the source again.
let inFlight: Promise<SyncReport> | null = null;
let lastRefreshedAt: number | null = null;
let lastReport: SyncReport | null = null;
try {
  const cached = loadModelsCacheV2();
  if (cached.syncedAt) {
    const at = Date.parse(cached.syncedAt);
    if (!Number.isNaN(at)) lastRefreshedAt = at;
  }
} catch {
  // ignore
}

/**
 * Merge a source's live "currently free" list into MODEL_REGISTRY:
 * - demote registry models of this provider that are no longer free,
 * - promote registry models that are now free,
 * - register brand-new free models.
 * Returns the change sets so the report is truthful.
 */
function mergeFreeModels(
  providerId: string,
  live: ModelInfo[]
): { newlyFree: string[]; noLongerFree: string[] } {
  const liveIds = new Set(live.map((m) => m.id));
  const newlyFree: string[] = [];
  const noLongerFree: string[] = [];

  for (const m of MODEL_REGISTRY) {
    if (m.providerId !== providerId) continue;
    if (m.isFree && !liveIds.has(m.id)) {
      m.isFree = false;
      m.displayName = m.displayName
        .replace(/\s*\(Free\)\s*$/i, "")
        .trim()
        .replace(/\s*\(Paid\)\s*$/i, "")
        .trim() + " (Paid)";
      noLongerFree.push(m.id);
    } else if (m.isFree === false && liveIds.has(m.id)) {
      m.isFree = true;
      m.displayName = m.displayName.replace(/\s*\(Paid\)\s*$/i, "").trim() + " (Free)";
      newlyFree.push(m.id);
    }
  }

  for (const liveModel of live) {
    if (!MODEL_REGISTRY.some((m) => m.id === liveModel.id)) {
      registerModel({ ...liveModel, isFree: true });
      newlyFree.push(liveModel.id);
    }
  }

  return { newlyFree, noLongerFree };
}

function reportFromCache(sources: FreeModelSource[]): SyncReport | null {
  const cached = loadModelsCacheV2();
  if (!cached.syncedAt) return null;
  const report: SyncReport = { refreshedAt: cached.syncedAt, results: [], errors: [] };
  for (const src of sources) {
    const models = cached.sources[src.id] ?? [];
    if (models.length === 0) {
      report.results.push({
        sourceId: src.id,
        ok: false,
        count: 0,
        newlyFree: [],
        noLongerFree: [],
        error: "no cached data for this source",
      });
    } else {
      report.results.push({
        sourceId: src.id,
        ok: true,
        count: models.length,
        newlyFree: [],
        noLongerFree: [],
      });
    }
  }
  report.errors = report.results.filter((r) => !r.ok).map((r) => `[${r.sourceId}] ${r.error ?? "error"}`);
  return report;
}

export async function syncFreeModels(opts: {
  sources: FreeModelSource[];
  apiKeyBySource?: Record<string, string | undefined>;
  ttlMs?: number;
}): Promise<SyncReport> {
  const ttlMs = opts.ttlMs ?? DEFAULT_SYNC_TTL_MS;

  // Single-flight: concurrent callers all share ONE actual sync.
  if (inFlight) return inFlight;

  // TTL: a refresh within the window is a no-op (report the data's true age).
  if (ttlMs > 0 && lastRefreshedAt !== null && Date.now() - lastRefreshedAt < ttlMs) {
    if (lastReport) return lastReport;
    const fromCache = reportFromCache(opts.sources);
    if (fromCache) {
      lastReport = fromCache;
      return fromCache;
    }
  }

  const exec = (async (): Promise<SyncReport> => {
    const startedAt = Date.now();
    const report: SyncReport = { refreshedAt: null, results: [], errors: [] };

    const outcomes = await Promise.all(
      opts.sources.map(async (src): Promise<SourceResult & { models: ModelInfo[] }> => {
        const result: SourceResult & { models: ModelInfo[] } = {
          sourceId: src.id,
          ok: false,
          count: 0,
          newlyFree: [],
          noLongerFree: [],
          models: [],
        };
        try {
          const models = await src.fetchFreeModels(opts.apiKeyBySource?.[src.id]);
          if (!Array.isArray(models)) throw new Error("fetchFreeModels did not return an array");
          result.models = models;
          result.count = models.length;
          const providerId = models[0]?.providerId ?? src.id;
          const change = mergeFreeModels(providerId, models);
          result.newlyFree = change.newlyFree;
          result.noLongerFree = change.noLongerFree;
          result.ok = true;
        } catch (err) {
          result.error = err instanceof Error ? err.message : String(err);
        }
        return result;
      })
    );

    const okOutcomes = outcomes.filter((o) => o.ok);
    // Persist cache v2 only after a successful merge — never a partial state.
    if (okOutcomes.length > 0) {
      const now = new Date().toISOString();
      const sources: Record<string, ModelInfo[]> = {};
      for (const o of okOutcomes) sources[o.sourceId] = o.models;
      const cache: ModelsCacheV2 = { version: 2, syncedAt: now, sources };
      saveModelsCacheV2(cache);
      report.refreshedAt = now;
      lastRefreshedAt = Date.now();
    }

    report.results = outcomes.map(({ models: _models, ...rest }) => rest);
    report.errors = outcomes.filter((o) => !o.ok).map((o) => `[${o.sourceId}] ${o.error ?? "unknown error"}`);
    lastReport = report;
    return report;
  })();

  inFlight = exec;
  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}