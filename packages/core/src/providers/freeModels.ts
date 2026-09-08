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

// --- Orcarouter free-model source (OpenAI-compatible sibling of OpenRouter). ---

export const ORCAROUTER_BASE_URL = "https://api.orcarouter.ai/v1";

/**
 * Orcarouter's /models endpoint carries NO pricing metadata — the free/paid
 * split is signaled only by the model id: a "-free" suffix, plus the
 * "orcarouter/free" auto-router alias (live-verified 2026-09: the "fusion"
 * family and "auto" are paid and must never pass this gate).
 */
export function isFreeModelId(id: string): boolean {
  return id.endsWith("-free") || id === "orcarouter/free";
}

/** "qwen/qwen3.8-27b-free" → "Qwen: Qwen3.8 27B"; "orcarouter/free" → "Free Models Router". */
function prettifyOrcarouterName(rawId: string): string {
  if (rawId === "orcarouter/free") return "Free Models Router";
  const slash = rawId.indexOf("/");
  const vendor = slash > 0 ? rawId.slice(0, slash) : "";
  const rest = slash > 0 ? rawId.slice(slash + 1) : rawId;
  const cleaned = rest
    .replace(/-free$/i, "")
    .replace(/[-_]/g, " ")
    .trim();
  const title = cleaned
    .replace(/\b([a-z])/g, (c) => c.toUpperCase())
    // "27b" → "27B" (parameter-size convention; there's no word boundary
    // between a digit and the letter that follows it).
    .replace(/([0-9])([a-z])/g, (_m, d: string, l: string) => d + l.toUpperCase());
  return vendor ? `${vendor.charAt(0).toUpperCase() + vendor.slice(1)}: ${title}` : title;
}

export async function fetchOrcarouterFreeModels(apiKey?: string): Promise<ModelInfo[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const headers: Record<string, string> = {};
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

    const res = await fetch(`${ORCAROUTER_BASE_URL}/models`, { signal: controller.signal, headers });
    if (!res.ok) {
      throw new Error(`Orcarouter /models returned HTTP ${res.status}: ${res.statusText}`);
    }

    const json = (await res.json()) as { data?: Array<any> };
    if (!Array.isArray(json?.data)) {
      throw new Error("Orcarouter /models response missing data array");
    }

    // Free-only gate: paid ids are dropped HERE, at the source, so a paid
    // model can never reach the registry, the picker, or merge demotion.
    // The id check is the provider's only free signal — there is no pricing
    // field to consult (unlike OpenRouter's pricing.prompt/completion).
    const freeModels: ModelInfo[] = [];
    for (const m of json.data) {
      if (typeof m.id !== "string" || !isFreeModelId(m.id)) continue;
      const rawName = typeof m.name === "string" && m.name.length > 0 ? m.name : m.id;
      freeModels.push({
        id: m.id,
        providerId: "orcarouter",
        displayName: `${prettifyOrcarouterName(rawName)} (Free)`,
        contextWindow: typeof m.context_length === "number" ? m.context_length : 128_000,
        supportsTools: true,
        supportsVision: false,
        isFree: true,
      });
    }

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