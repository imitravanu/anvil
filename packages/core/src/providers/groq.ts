import { ModelProvider } from "./types.js";
import { createChatCompletionsStyleProvider } from "./openai.js";

export const GROQ_BASE_URL = "https://api.groq.com/openai/v1";

export function createGroqProvider(apiKey: string | undefined): ModelProvider {
  return createChatCompletionsStyleProvider({
    id: "groq",
    displayName: "Groq",
    apiKey,
    baseURL: GROQ_BASE_URL,
    maxTokensParam: "max_tokens",
    supportsVision: false,
  });
}
