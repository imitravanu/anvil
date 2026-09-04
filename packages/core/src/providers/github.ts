import { ModelProvider } from "./types.js";
import { createChatCompletionsStyleProvider } from "./openai.js";

export const GITHUB_MODELS_BASE_URL = "https://models.inference.ai.azure.com";

export function createGitHubModelsProvider(apiKey: string | undefined): ModelProvider {
  return createChatCompletionsStyleProvider({
    id: "github",
    displayName: "GitHub Models",
    apiKey,
    baseURL: GITHUB_MODELS_BASE_URL,
    maxTokensParam: "max_tokens",
  });
}
