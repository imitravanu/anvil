import { getErrorMessage } from "../errors.js";
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
const REFERER = "https://github.com/imitravanu/anvil";
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

/** Orcarouter's public pricing-catalog row (distinct field names from OpenRouter). */
export interface OrcarouterCatalogModel {
  model_name?: string;
  display_name?: string;
  is_free_tier?: boolean;
  context_length?: number;
  supported_parameters?: string[];
  input_modalities?: string[];
}

export interface OpenRouterModel {
  id: string;
  name?: string;
  pricing?: {
    prompt?: string | number;
    completion?: string | number;
  };
  context_length?: number;
  supported_parameters?: string[];
  architecture?: {
    modality?: string;
  };
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

    const json = (await res.json()) as { data?: Array<OpenRouterModel> };
    if (!Array.isArray(json?.data)) {
      throw new Error("OpenRouter /models response missing data array");
    }

    const freeModels: ModelInfo[] = [];
    for (const m of json.data) {
      // Pricing may arrive as "0", "0.0", or 0 depending on the API version.
      const promptPrice = Number(m.pricing?.prompt);
      const completionPrice = Number(m.pricing?.completion);
      const hasPricing = m.pricing != null && typeof m.pricing === "object";
      const isZeroPrice =
        hasPricing &&
        !isNaN(promptPrice) &&
        promptPrice === 0 &&
        !isNaN(completionPrice) &&
        completionPrice === 0;
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

// --- Orcarouter free-model source (OpenAI-compatible sibling of OpenRouter). ---

export const ORCAROUTER_BASE_URL = "https://api.orcarouter.ai/v1";
/** Public, key-less pricing catalog — the source of truth for free ids (live-verified 2026-09). */
export const ORCAROUTER_PRICING_URL = "https://api.orcarouter.ai/api/pricing";

/**
 * Orcarouter's /models endpoint carries NO pricing metadata AND is stale
 * (live-verified 2026-09: delisted qwen still listed, new GLM free ids
 * missing) — free/paid is signaled only by the id: a "-free" suffix, plus
 * the "orcarouter/free" auto-router alias (the "fusion" family and "auto"
 * are paid and must never pass this gate).
 */
export function isFreeModelId(id: string): boolean {
  return id.endsWith("-free") || id === "orcarouter/free";
}

/** "orcarouter/free" → "Free Models Router"; vendor prefix title-cased. */
function prettifyOrcarouterVendor(rawId: string): string {
  const slash = rawId.indexOf("/");
  if (slash <= 0) return "";
  const vendor = rawId.slice(0, slash);
  // "z-ai" → "Z.ai" (matches the provider's own "Z.ai: ..." display names).
  if (vendor.toLowerCase() === "z-ai") return "Z.ai";
  return vendor.charAt(0).toUpperCase() + vendor.slice(1);
}

/**
 * Free models via the PUBLIC pricing catalog — key-less, authoritative
 * (`is_free_tier: true`), with live display names, context windows, and
 * tool/vision capability flags. The keyed /v1/models listing is stale
 * (still shows the delisted qwen; misses the new ids) and carries no
 * pricing — do not use it for free discovery.
 *
 * Paid models are dropped HERE, at the source, so a paid model can never
 * reach the registry, the picker, or merge demotion. Free is decided ONLY
 * by the authoritative `is_free_tier` flag — never by `model_ratio: 0`
 * (image/video endpoints ride along at 0 cost; image generation is not
 * free chat) and never by the id suffix (a catalog listing can go stale).
 *
 * `orcarouter/free` is NOT in the pricing catalog (it's a named router,
 * not a priced model) and is appended manually — documented behavior,
 * key must whitelist it explicitly per the Free Models docs.
 */
export async function fetchOrcarouterFreeModels(apiKey?: string): Promise<ModelInfo[]> {
  void apiKey; // key-less public catalog; signature kept for FreeModelSource.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(ORCAROUTER_PRICING_URL, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`Orcarouter pricing catalog returned HTTP ${res.status}: ${res.statusText}`);
    }

    const json = (await res.json()) as { data?: OrcarouterCatalogModel[] };
    if (!Array.isArray(json?.data)) {
      throw new Error("Orcarouter pricing catalog response missing data array");
    }

    const freeModels: ModelInfo[] = [];
    for (const m of json.data) {
      // Single authority: the is_free_tier flag. The -free suffix is the
      // provider's documented convention but NOT a fallback — id and flag
      // have demonstrably disagreed (stale qwen still "-free", absent
      // from live data), so the flag alone decides.
      if (m.is_free_tier !== true) continue;
      if (typeof m.model_name !== "string" || m.model_name.length === 0) continue;

      const id: string = m.model_name;
      const params: unknown = m.supported_parameters;
      const modalities: unknown = m.input_modalities;
      freeModels.push({
        id,
        providerId: "orcarouter",
        displayName:
          typeof m.display_name === "string" && m.display_name.length > 0
            ? m.display_name
            : `${prettifyOrcarouterVendor(id)}: ${id} (Free)`,
        contextWindow: typeof m.context_length === "number" ? m.context_length : 128_000,
        supportsTools: Array.isArray(params) && params.includes("tools"),
        supportsVision:
          Array.isArray(modalities) && (modalities.includes("image") || modalities.includes("video")),
        isFree: true,
      });
    }
    if (freeModels.length === 0) {
      throw new Error("Orcarouter pricing catalog listed zero free-tier models");
    }

    // Named auto-router: not a priced model, so never in the catalog —
    // appended explicitly (documents as covering the free tier; keys must
    // whitelist it per the provider docs).
    freeModels.push({
      id: "orcarouter/free",
      providerId: "orcarouter",
      displayName: "Free Models Router (Free)",
      contextWindow: 128_000,
      supportsTools: true,
      supportsVision: false,
      isFree: true,
    });

    // Auto-router alias first (mirrors the openrouter/free convention).
    freeModels.sort((a, b) => {
      if (a.id === "orcarouter/free") return -1;
      if (b.id === "orcarouter/free") return 1;
      return a.displayName.localeCompare(b.displayName);
    });
    return freeModels;
  } finally {
    clearTimeout(timer);
  }
}

export function createOrcarouterFreeSource(): FreeModelSource {
  return { id: "orcarouter", fetchFreeModels: (key) => fetchOrcarouterFreeModels(key) };
}

// --- Recorded 429/rate-limit health with exponential backoff and circuit breaker. ---

const rateLimited = new Map<string, Set<string>>(); // sourceId -> model ids
const consecutiveRateLimits = new Map<string, number>(); // sourceId:modelId -> consecutive count

const CIRCUIT_BREAKER_THRESHOLD = 5;
const CIRCUIT_BREAKER_TIMEOUT_MS = 60_000;
type CircuitState = "closed" | "open" | "half-open";
interface CircuitBreakerEntry {
  state: CircuitState;
  failureCount: number;
  lastFailureAt: number;
  halfOpenAt: number;
}
const circuitBreakers = new Map<string, CircuitBreakerEntry>();

function circuitKey(sourceId: string, modelId: string): string {
  return `${sourceId}:${modelId}`;
}

function getCircuitBreaker(sourceId: string, modelId: string): CircuitBreakerEntry {
  const key = circuitKey(sourceId, modelId);
  let cb = circuitBreakers.get(key);
  if (!cb) {
    cb = { state: "closed", failureCount: 0, lastFailureAt: 0, halfOpenAt: 0 };
    circuitBreakers.set(key, cb);
  }
  return cb;
}

export function noteRateLimited(sourceId: string, modelId: string): void {
  let set = rateLimited.get(sourceId);
  if (!set) {
    set = new Set();
    rateLimited.set(sourceId, set);
  }
  set.add(modelId);
  // Health record + backoff counter only — the circuit breaker is driven
  // exclusively by recordFailure()/recordSuccess() so one 429 can never
  // be counted twice.
  const key = `${sourceId}:${modelId}`;
  const consecutive = (consecutiveRateLimits.get(key) ?? 0) + 1;
  consecutiveRateLimits.set(key, consecutive);
}

export function isRateLimited(sourceId: string, modelId: string): boolean {
  return rateLimited.get(sourceId)?.has(modelId) ?? false;
}

export function isCircuitOpen(sourceId: string, modelId: string): boolean {
  const cb = getCircuitBreaker(sourceId, modelId);
  if (cb.state === "closed") return false;
  if (cb.state === "open") {
    if (Date.now() >= cb.halfOpenAt) {
      cb.state = "half-open";
      return false;
    }
    return true;
  }
  return false;
}

export function getCircuitState(sourceId: string, modelId: string): CircuitState {
  return getCircuitBreaker(sourceId, modelId).state;
}

export function getRateLimitedModels(): Readonly<Record<string, readonly string[]>> {
  const out: Record<string, readonly string[]> = {};
  for (const [source, set] of rateLimited) out[source] = [...set];
  return out;
}

export function clearRateLimitRecord(sourceId: string, modelId: string): void {
  const key = `${sourceId}:${modelId}`;
  consecutiveRateLimits.delete(key);
  rateLimited.get(sourceId)?.delete(modelId);
  const cb = circuitBreakers.get(key);
  if (cb) {
    cb.failureCount = 0;
    cb.state = "closed";
  }
}

export function recordSuccess(sourceId: string, modelId: string): void {
  clearRateLimitRecord(sourceId, modelId);
  const cb = getCircuitBreaker(sourceId, modelId);
  cb.state = "closed";
  cb.failureCount = 0;
}

export function recordFailure(sourceId: string, modelId: string): void {
  const cb = getCircuitBreaker(sourceId, modelId);
  cb.failureCount++;
  cb.lastFailureAt = Date.now();
  if (cb.failureCount >= CIRCUIT_BREAKER_THRESHOLD) {
    cb.state = "open";
    cb.halfOpenAt = Date.now() + CIRCUIT_BREAKER_TIMEOUT_MS;
  }
}

export function getConsecutiveRateLimitCount(sourceId: string, modelId: string): number {
  return consecutiveRateLimits.get(`${sourceId}:${modelId}`) ?? 0;
}

/**
 * Prune stale health records for models that are no longer free (audit fix #3).
 *
 * When a free-model sync demotes a model (the source stopped listing it), its
 * rate-limit backoff counters, circuit-breaker state, and 429 marks would
 * otherwise sit in process-visible maps forever — a slow leak, and worse, a
 * demoted-then-re-added model could surface a STALE "open" breaker from its
 * previous life. Pruning is keyed by modelId across sources: the registry's
 * model ids are unique, and the worst-case misfire (an id collision across a
 * real provider) merely clears backoff state, which is benign and self-healing.
 */
export function pruneHealthForModels(modelIds: readonly string[]): void {
  const gone = new Set(modelIds);
  if (gone.size === 0) return;
  for (const [sourceId, set] of rateLimited) {
    for (const modelId of [...set]) {
      if (gone.has(modelId)) set.delete(modelId);
    }
    if (set.size === 0) rateLimited.delete(sourceId);
  }
  const stripSource = (key: string): string => key.slice(key.indexOf(":") + 1);
  for (const key of [...consecutiveRateLimits.keys()]) {
    if (gone.has(stripSource(key))) consecutiveRateLimits.delete(key);
  }
  for (const key of [...circuitBreakers.keys()]) {
    if (gone.has(stripSource(key))) circuitBreakers.delete(key);
  }
}

/** Loose detector for rate-limit/quota errors so the agent loop can RECORD them. */
export function isRateLimitMessage(message: string): boolean {
  // "No available capacity" (orcarouter free models, HTTP 503) is the same
  // operational reality as a 429 — transient, self-healing, retry-with-backoff.
  return /\b429\b|rate\s*[- ]?limit|quota|too many requests|no available capacity/i.test(message);
}

const MIN_RETRY_WAIT_S = 1;
const MAX_RETRY_WAIT_S = 120;
const DEFAULT_RETRY_WAIT_S = 20;
const BACKOFF_MULTIPLIER = 2;

/**
 * Wait seconds before an automatic retry, parsed from the provider message
 * ("Please retry in 53.2s") and adjusted for consecutive failures via exponential
 * backoff. Providers that don't advertise a window get a conservative default;
 * everything clamps to [1, 120] so a hostile value can neither busy-loop the
 * turn nor park it for an hour.
 */
export function rateLimitRetrySeconds(message: string, consecutiveFailures: number = 1): number {
  const m = message.match(/retry in ([\d.]+)\s*s/i);
  let parsed = m ? Math.ceil(parseFloat(m[1])) : DEFAULT_RETRY_WAIT_S;
  if (!Number.isFinite(parsed) || parsed < MIN_RETRY_WAIT_S) parsed = MIN_RETRY_WAIT_S;
  parsed = Math.min(parsed, MAX_RETRY_WAIT_S);
  if (consecutiveFailures > 1) {
    const backoff = Math.min(parsed * Math.pow(BACKOFF_MULTIPLIER, consecutiveFailures - 1), MAX_RETRY_WAIT_S);
    parsed = Math.max(parsed, backoff);
  }
  return parsed;
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
    // intentional: cache read failure means unseeded, treat as unsynced
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
      // Health records for a demoted model are stale by definition (audit
      // fix #3): clear its 429 backoff, breaker state, and rate-limit mark
      // so a re-added model starts clean instead of inheriting an old
      // "open" breaker or half-spent backoff from its previous life.
      pruneHealthForModels([m.id]);
    } else if (m.isFree === false && liveIds.has(m.id)) {
      m.isFree = true;
      m.displayName = m.displayName.replace(/\s*\(Paid\)\s*$/i, "").trim() + " (Free)";
      newlyFree.push(m.id);
    }
  }

  for (const liveModel of live) {
    // Scope by provider: an id collision across providers (e.g. gpt-4o-mini
    // on both OpenAI and GitHub) must not suppress registration — each
    // provider owns its own row.
    if (!MODEL_REGISTRY.some((m) => m.id === liveModel.id && m.providerId === liveModel.providerId)) {
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
          result.error = getErrorMessage(err);
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