import { ModelProvider, ProviderId } from "./types.js";
import { createAnthropicProvider } from "./anthropic.js";
import { createOpenAIProvider } from "./openai.js";
import { createGeminiProvider } from "./gemini.js";
import { createOpenRouterProvider } from "./openrouter.js";

export * from "./types.js";
export * from "./registry.js";

export interface ProviderCredentials {
  anthropicApiKey?: string;
  openaiApiKey?: string;
  geminiApiKey?: string;
  openrouterApiKey?: string;
}

export function createProviders(creds: ProviderCredentials): Record<ProviderId, ModelProvider> {
  return {
    anthropic: createAnthropicProvider(creds.anthropicApiKey),
    openai: createOpenAIProvider(creds.openaiApiKey),
    gemini: createGeminiProvider(creds.geminiApiKey),
    openrouter: createOpenRouterProvider(creds.openrouterApiKey),
  };
}
