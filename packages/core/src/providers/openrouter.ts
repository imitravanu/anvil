import { ModelProvider } from "./types.js";
import { createChatCompletionsStyleProvider } from "./openai.js";

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
  });
}
