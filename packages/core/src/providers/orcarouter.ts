import { ModelProvider } from "./types.js";
import { createChatCompletionsStyleProvider } from "./openai.js";
import { ORCAROUTER_BASE_URL } from "./freeModels.js";

/**
 * Orcarouter (https://api.orcarouter.ai) — OpenAI-compatible model router,
 * sibling of the OpenRouter integration: same chat-completions wire format,
 * different gateway and credential. Free discovery uses the PUBLIC
 * key-less pricing catalog (`is_free_tier: true` flag) — the keyed
 * /v1/models listing is stale and carries no pricing — and `isFreeModelId`
 * remains the sync shape's id gate. Free-only policy lives there, so paid
 * models can never reach the registry or the picker.
 */
// Backward-compat re-exports: the base URL, fetch implementation, and
// free-id gate live in freeModels.ts (the single owner of free-model
// discovery), mirroring openrouter.ts.
export {
  ORCAROUTER_BASE_URL,
  ORCAROUTER_PRICING_URL,
  fetchOrcarouterFreeModels,
  isFreeModelId,
} from "./freeModels.js";

export function createOrcarouterProvider(apiKey: string | undefined): ModelProvider {
  return createChatCompletionsStyleProvider({
    id: "orcarouter",
    displayName: "Orcarouter",
    apiKey,
    baseURL: ORCAROUTER_BASE_URL,
    maxTokensParam: "max_tokens",
  });
}
