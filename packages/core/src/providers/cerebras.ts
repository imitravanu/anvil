import { ModelProvider } from "./types.js";
import { createChatCompletionsStyleProvider } from "./openai.js";

export const CEREBRAS_BASE_URL = "https://api.cerebras.ai/v1";

export function createCerebrasProvider(apiKey: string | undefined): ModelProvider {
  return createChatCompletionsStyleProvider({
    id: "cerebras",
    displayName: "Cerebras",
    apiKey,
    baseURL: CEREBRAS_BASE_URL,
    maxTokensParam: "max_tokens",
    supportsVision: false,
  });
}
