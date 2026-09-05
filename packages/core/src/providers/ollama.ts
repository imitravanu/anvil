import { ModelProvider } from "./types.js";
import { createChatCompletionsStyleProvider } from "./openai.js";

export const OLLAMA_DEFAULT_BASE_URL = "http://localhost:11434/v1";

/** Resolve the OpenAI-compatible base URL, tolerating a user-supplied /v1 suffix. */
export function ollamaBaseURL(): string {
  const host = process.env.OLLAMA_HOST;
  if (!host) return OLLAMA_DEFAULT_BASE_URL;
  return /\/v1\/?$/.test(host)
    ? host.replace(/\/+$/, "")
    : `${host.replace(/\/+$/, "")}/v1`;
}

export function createOllamaProvider(apiKey: string | undefined): ModelProvider {
  const isConfigured = !!(apiKey || process.env.OLLAMA_HOST);
  const baseURL = ollamaBaseURL();
  return createChatCompletionsStyleProvider({
    id: "ollama",
    displayName: "Ollama (Local)",
    apiKey: isConfigured ? (apiKey || "ollama") : undefined,
    baseURL,
    maxTokensParam: "max_tokens",
  });
}
