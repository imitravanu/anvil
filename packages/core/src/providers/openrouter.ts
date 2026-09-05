import { ModelProvider } from "./types.js";
import { createChatCompletionsStyleProvider } from "./openai.js";
import {
  OPENROUTER_BASE_URL,
  createOpenRouterFreeSource,
  syncFreeModels,
} from "./freeModels.js";

// Backward-compat re-exports. The fetch implementation lives in
// freeModels.ts so the coordinator is the single owner of free-model syncing.
export { OPENROUTER_BASE_URL, fetchOpenRouterFreeModels } from "./freeModels.js";

export interface SyncResult {
  freeCount: number;
  newlyFree: string[];
  noLongerFree: string[];
}

/**
 * Compatibility wrapper. The coordinator (syncFreeModels) is authoritative;
 * this maps its report back to the old SyncResult shape.
 */
export async function syncOpenRouterModels(apiKey?: string): Promise<SyncResult> {
  const report = await syncFreeModels({
    sources: [createOpenRouterFreeSource()],
    apiKeyBySource: apiKey ? { openrouter: apiKey } : undefined,
    ttlMs: 0, // an explicit, force-refresh call site
  });
  const open = report.results.find((r) => r.sourceId === "openrouter");
  return {
    freeCount: open?.count ?? 0,
    newlyFree: open?.newlyFree ?? [],
    noLongerFree: open?.noLongerFree ?? [],
  };
}

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