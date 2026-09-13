import { ModelProvider } from "./types.js";
import { createChatCompletionsStyleProvider } from "./openai.js";

export const MISTRAL_BASE_URL = "https://api.mistral.ai/v1";

export function createMistralProvider(apiKey: string | undefined): ModelProvider {
  return createChatCompletionsStyleProvider({
    id: "mistral",
    displayName: "Mistral AI",
    apiKey,
    baseURL: MISTRAL_BASE_URL,
    maxTokensParam: "max_tokens",
    supportsVision: false,
  });
}
