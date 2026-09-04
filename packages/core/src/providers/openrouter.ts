import { ModelInfo, ModelProvider } from "./types.js";
import { createChatCompletionsStyleProvider } from "./openai.js";
import { MODEL_REGISTRY, registerModel } from "./registry.js";
import { saveModelsCache } from "./cache.js";

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/**
 * OpenRouter deliberately mimics the OpenAI chat-completions API, so this
 * adapter is just the shared OpenAI translation engine pointed at OpenRouter's
 * base URL with an OpenRouter API key — no duplicated streaming-parse code.
 */
export function createOpenRouterProvider(apiKey: string | undefined): ModelProvider {
  return createChatCompletionsStyleProvider({
    id: "openrouter",
    displayName: "OpenRouter",
    apiKey,
    baseURL: OPENROUTER_BASE_URL,
    // OpenRouter's gateway expects the classic `max_tokens` parameter.
    maxTokensParam: "max_tokens",
    defaultHeaders: {
      "HTTP-Referer": "https://github.com/mitravanu/anvil",
      "X-Title": "Anvil",
    },
  });
}

/**
 * Query OpenRouter API for free models dynamically.
 * Filters for models with zero prompt & completion cost, or ending in :free / openrouter/free.
 */
export async function fetchOpenRouterFreeModels(apiKey?: string): Promise<ModelInfo[]> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const headers: Record<string, string> = {
      "HTTP-Referer": "https://github.com/mitravanu/anvil",
      "X-Title": "Anvil",
    };
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    const res = await fetch(`${OPENROUTER_BASE_URL}/models`, {
      signal: controller.signal,
      headers,
    });
    clearTimeout(timer);

    if (!res.ok) return [];
    const json = (await res.json()) as { data?: Array<any> };
    if (!Array.isArray(json.data)) return [];

    const freeModels: ModelInfo[] = [];
    for (const m of json.data) {
      const isZeroPrice = m.pricing?.prompt === "0" && m.pricing?.completion === "0";
      const isFreeId = typeof m.id === "string" && (m.id.endsWith(":free") || m.id === "openrouter/free");
      if (!isZeroPrice && !isFreeId) continue;

      const supportsTools =
        Array.isArray(m.supported_parameters) && m.supported_parameters.includes("tools");
      const supportsVision =
        typeof m.architecture?.modality === "string" &&
        m.architecture.modality.includes("image");

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

    // Sort: openrouter/free first, then tools-supporting models, then alphabetical
    freeModels.sort((a, b) => {
      if (a.id === "openrouter/free") return -1;
      if (b.id === "openrouter/free") return 1;
      if (a.supportsTools !== b.supportsTools) {
        return a.supportsTools ? -1 : 1;
      }
      return a.displayName.localeCompare(b.displayName);
    });

    return freeModels;
  } catch {
    return [];
  }
}

export interface SyncResult {
  freeCount: number;
  newlyFree: string[];
  noLongerFree: string[];
}

/**
 * Live sync with OpenRouter models API:
 * - If a model becomes paid tomorrow, demote it and mark [PAID] automatically.
 * - If a model becomes free tomorrow, promote/add it and mark [FREE] automatically.
 * Zero manual coding required!
 */
export async function syncOpenRouterModels(apiKey?: string): Promise<SyncResult> {
  const result: SyncResult = {
    freeCount: 0,
    newlyFree: [],
    noLongerFree: [],
  };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4500);
    const headers: Record<string, string> = {
      "HTTP-Referer": "https://github.com/mitravanu/anvil",
      "X-Title": "Anvil",
    };
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    const res = await fetch(`${OPENROUTER_BASE_URL}/models`, {
      signal: controller.signal,
      headers,
    });
    clearTimeout(timer);

    if (!res.ok) return result;
    const json = (await res.json()) as { data?: Array<any> };
    if (!Array.isArray(json.data)) return result;

    const liveFreeMap = new Map<string, any>();
    for (const m of json.data) {
      const isZeroPrice = m.pricing?.prompt === "0" && m.pricing?.completion === "0";
      const isFreeId = typeof m.id === "string" && (m.id.endsWith(":free") || m.id === "openrouter/free");
      if (isZeroPrice || isFreeId) {
        liveFreeMap.set(m.id, m);
      }
    }

    result.freeCount = liveFreeMap.size;

    // 1. Check existing openrouter models in MODEL_REGISTRY: update free vs paid status
    for (const m of MODEL_REGISTRY) {
      if (m.providerId !== "openrouter") continue;
      if (m.isFree && !liveFreeMap.has(m.id)) {
        // Model used to be free, but OpenRouter now charges for it!
        m.isFree = false;
        m.displayName = m.displayName.replace(/\s*\(Free\)\s*$/i, "").trim() + " (Paid)";
        result.noLongerFree.push(m.id);
      } else if (!m.isFree && liveFreeMap.has(m.id)) {
        // Model was paid, but OpenRouter now offers it for free!
        m.isFree = true;
        m.displayName = m.displayName.replace(/\s*\(Paid\)\s*$/i, "").trim() + " (Free)";
        result.newlyFree.push(m.id);
      }
    }

    // 2. Add any newly appeared free models not currently in MODEL_REGISTRY
    for (const [id, m] of liveFreeMap.entries()) {
      const exists = MODEL_REGISTRY.some((existing) => existing.id === id);
      if (!exists) {
        const supportsTools =
          Array.isArray(m.supported_parameters) && m.supported_parameters.includes("tools");
        const supportsVision =
          typeof m.architecture?.modality === "string" &&
          m.architecture.modality.includes("image");
        const rawName = typeof m.name === "string" ? m.name : m.id;
        const cleanName = rawName.replace(/\s*\(free\)\s*$/i, "").trim();

        const newModel: ModelInfo = {
          id: m.id,
          providerId: "openrouter",
          displayName: `${cleanName} (Free)`,
          contextWindow: typeof m.context_length === "number" ? m.context_length : 128_000,
          supportsTools,
          supportsVision,
          isFree: true,
        };

        registerModel(newModel);
        result.newlyFree.push(id);
      }
    }

    saveModelsCache(MODEL_REGISTRY);
    return result;
  } catch {
    return result;
  }
}
