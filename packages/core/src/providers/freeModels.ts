import { createHash } from "node:crypto";
import { ModelInfo } from "./types.js";
import { MODEL_REGISTRY, registerModel } from "./registry.js";
import { loadModelsCacheV2, saveModelsCacheV2, ModelsCacheV2 } from "./cache.js";

// ---------------------------------------------------------------------------
// one owner for free-model discovery. Any provider that publishes
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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const headers: Record<string, string> = { "HTTP-Referer": REFERER, "X-Title": TITLE };
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

    const res = await fetch(`${OPENROUTER_BASE_URL}/models`, { signal: controller.signal, headers });
    if (!res.ok) {
      throw new Error(`OpenRouter /models returned HTTP ${res.status}: ${res.statusText}`);
    }

    const json = (await res.json()) as { data?: Array<any> };
    if (!Array.isArray(json?.data)) {
      throw new Error("OpenRouter /models response missing data array");
    }

    const freeModels: ModelInfo[] = [];
    for (const m of json.data) {
      // Pricing may arrive as "0" or 0 depending on the API version — accept both.
      const isZeroPrice =
        String(m.pricing?.prompt ?? "") === "0" && String(m.pricing?.completion ?? "") === "0";
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
  } finally {
    clearTimeout(timer);
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
// --- The single owner of free-model sync . ---

// Per-key flight + freshness state. The old code shared ONE global promise
// and clock across all callers (wrong creds shared, import-time ANVIL_HOME
// seeding) — keyed by sources + ttl + key-hash instead. Key hashes (never
// raw keys) so secrets never sit in process-visible state.

const flights = new Map<string, Promise<SyncReport>>();
const freshness = new Map<string, { at: number; report: SyncReport | null }>();

function flightKey(
  sources: FreeModelSource[],
  apiKeyBySource: Record<string, string | undefined> | undefined
): string {
  const keyHash = createHash("sha256")
    .update(
      sources
        .map((s) => `${s.id}:${apiKeyBySource?.[s.id] ?? ""}`)
        .sort()
        .join("|"),
      "utf8"
    )
    .digest("hex")
    .slice(0, 16);
  // NOTE: ttlMs is deliberately NOT part of the key — it is a read policy
  // for the freshness window, not an identity. Same sources+keys share.
  return `${sources.map((s) => s.id).sort().join(",")}|${keyHash}`;
}

/** Lazy freshness seed from the persisted cache (no import-time ANVIL_HOME read). */
function seedFreshness(key: string): { at: number; report: SyncReport | null } | null {
  const existing = freshness.get(key);
  if (existing) return existing;
  try {
    const cached = loadModelsCacheV2();
    if (cached.syncedAt) {
      const at = Date.parse(cached.syncedAt);
      if (!Number.isNaN(at)) {
        const seeded = { at, report: null as SyncReport | null };
        freshness.set(key, seeded);
        return seeded;
      }
    }
  } catch {
    // ignore — unseeded behaves as never-synced
  }
  return null;
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
  // Discovery #2: An empty live list cannot drive demotions. Demotion requires a
  // non-empty list that omits the model. An empty list is a source glitch or
  // network failure, not "everything became paid".
  if (live.length === 0) {
    return { newlyFree: [], noLongerFree: [] };
  }
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
  const key = flightKey(opts.sources, opts.apiKeyBySource);

  // Single-flight per key: callers with the same sources/ttl/keys share one
  // sync; different options fly separately, so wrong creds never poison a
  // shared flight.
  const flying = flights.get(key);
  if (flying) return flying;

  // TTL: a refresh within the window is a no-op (report the data's true age).
  if (ttlMs > 0) {
    const fresh = freshness.get(key) ?? seedFreshness(key);
    if (fresh && Date.now() - fresh.at < ttlMs) {
      if (fresh.report) return fresh.report;
      const fromCache = reportFromCache(opts.sources);
      if (fromCache) {
        fresh.report = fromCache;
        return fromCache;
      }
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
          // A source may serve several providers: merge per provider group
          // instead of attributing the whole list to the first model's owner.
          const byProvider = new Map<string, ModelInfo[]>();
          for (const m of models) {
            const pid = m.providerId ?? src.id;
            const list = byProvider.get(pid);
            if (list) list.push(m);
            else byProvider.set(pid, [m]);
          }
          for (const [pid, list] of byProvider) {
            const change = mergeFreeModels(pid, list);
            result.newlyFree.push(...change.newlyFree);
            result.noLongerFree.push(...change.noLongerFree);
          }
          result.ok = true;
        } catch (err) {
          result.error = err instanceof Error ? err.message : String(err);
        }
        return result;
      })
    );

    const okOutcomes = outcomes.filter((o) => o.ok);
    // Persist merge-preserving cache: overwrite ONLY succeeded sources, keep
    // stale entries for failed ones. A transient single-source failure must
    // not wipe that source's cached models while stamping "fresh".
    if (okOutcomes.length > 0) {
      const now = new Date().toISOString();
      const previous = loadModelsCacheV2().sources;
      const sources: Record<string, ModelInfo[]> = { ...previous };
      for (const o of okOutcomes) sources[o.sourceId] = o.models;
      const cache: ModelsCacheV2 = { version: 2, syncedAt: now, sources };
      saveModelsCacheV2(cache);
      report.refreshedAt = now;
    }

    report.results = outcomes.map(({ models: _models, ...rest }) => rest);
    report.errors = outcomes.filter((o) => !o.ok).map((o) => `[${o.sourceId}] ${o.error ?? "unknown error"}`);
    // Record freshness only on partial-or-better success: an all-failed sync
    // leaves the previous clock alone so the next call retries instead of
    // serving the failure from TTL.
    if (okOutcomes.length > 0) {
      freshness.set(key, { at: Date.now(), report });
    }
    return report;
  })();

  flights.set(key, exec);
  try {
    return await exec;
  } finally {
    flights.delete(key);
  }
}