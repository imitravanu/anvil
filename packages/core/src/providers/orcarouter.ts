import { ModelProvider } from "./types.js";
import { createChatCompletionsStyleProvider } from "./openai.js";
import { ORCAROUTER_BASE_URL } from "./freeModels.js";

/**
 * Orcarouter (https://api.orcarouter.ai) — OpenAI-compatible model router,
 * sibling of the OpenRouter integration: same chat-completions wire format,
 * different gateway and credential. Its /models endpoint carries no pricing
 * metadata — the free/paid split is signaled ONLY by the model id (see
 * `isFreeModelId` in freeModels.ts). Free-only policy lives there, so paid
 * models can never reach the registry or the picker.
 */
// Backward-compat re-exports: the base URL, fetch implementation, and
// free-id gate live in freeModels.ts (the single owner of free-model
// discovery), mirroring openrouter.ts.
export { ORCAROUTER_BASE_URL, fetchOrcarouterFreeModels, isFreeModelId } from "./freeModels.js";

export function createOrcarouterProvider(apiKey: string | undefined): ModelProvider {
  return createChatCompletionsStyleProvider({
    id: "orcarouter",
    displayName: "Orcarouter",
    apiKey,
    baseURL: ORCAROUTER_BASE_URL,
    maxTokensParam: "max_tokens",
  });
}
