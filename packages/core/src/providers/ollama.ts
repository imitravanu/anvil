import { ModelProvider } from "./types.js";
import { createChatCompletionsStyleProvider } from "./openai.js";

export const OLLAMA_DEFAULT_BASE_URL = "http://localhost:11434/v1";

export function createOllamaProvider(apiKey: string | undefined): ModelProvider {
  const isConfigured = !!(apiKey || process.env.OLLAMA_HOST);
  const baseURL = process.env.OLLAMA_HOST
    ? `${process.env.OLLAMA_HOST.replace(/\/+$/, "")}/v1`
    : OLLAMA_DEFAULT_BASE_URL;
  return createChatCompletionsStyleProvider({
    id: "ollama",
    displayName: "Ollama (Local)",
    apiKey: isConfigured ? (apiKey || "ollama") : undefined,
    baseURL,
    maxTokensParam: "max_tokens",
  });
}
