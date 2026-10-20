import { ModelProvider, ProviderId } from "./types.js";
import { createAnthropicProvider } from "./anthropic.js";
import { createOpenAIProvider } from "./openai.js";
import { createGeminiProvider } from "./gemini.js";
import { createOpenRouterProvider } from "./openrouter.js";
import { createOrcarouterProvider } from "./orcarouter.js";
import { createGroqProvider } from "./groq.js";
import { createCerebrasProvider } from "./cerebras.js";
import { createGitHubModelsProvider } from "./github.js";
import { createMistralProvider } from "./mistral.js";
import { createInceptionProvider } from "./inception.js";
import { createOllamaProvider } from "./ollama.js";
import { createQwenCloudProvider } from "./qwencloud.js";
import { createAgentRouterProvider } from "./agentrouter.js";
import { createCustomProvider, customProviderModels, loadCustomProviders, type CustomProviderConfig } from "./custom.js";
import { syncCustomProviderModels } from "./registry.js";

export * from "./types.js";
export { loadCustomProviders, saveCustomProvider, removeCustomProvider, validateCustomProvider, isCustomProviderConfigured, customProviderModels, type CustomProviderConfig } from "./custom.js";
export * from "./registry.js";
export { BaseProvider } from "./base.js";
export { AnthropicProvider } from "./anthropic.js";
export { ChatCompletionsStyleProvider } from "./openai.js";
export { GeminiProvider } from "./gemini.js";
export { OPENROUTER_BASE_URL, createOpenRouterProvider, fetchOpenRouterFreeModels, syncOpenRouterModels } from "./openrouter.js";
export {
  ORCAROUTER_BASE_URL,
  ORCAROUTER_PRICING_URL,
  createOrcarouterProvider,
  fetchOrcarouterFreeModels,
  isFreeModelId,
} from "./orcarouter.js";
export {
  DEFAULT_SYNC_TTL_MS,
  createOpenRouterFreeSource,
  createOrcarouterFreeSource,
  syncFreeModels,
  noteRateLimited,
  isRateLimited,
  getRateLimitedModels,
  isRateLimitMessage,
  isQuotaExhaustedMessage,
  type FreeModelSource,
  type SourceResult,
  type SyncReport,
} from "./freeModels.js";
export {
  loadModelsCache,
  saveModelsCache,
  loadModelsCacheV2,
  saveModelsCacheV2,
  isModelsCacheFresh,
  collectModelsFromCache,
  type ModelsCacheV2,
} from "./cache.js";
export { GROQ_BASE_URL, createGroqProvider } from "./groq.js";
export { CEREBRAS_BASE_URL, createCerebrasProvider } from "./cerebras.js";
export { GITHUB_MODELS_BASE_URL, createGitHubModelsProvider } from "./github.js";
export { MISTRAL_BASE_URL, createMistralProvider } from "./mistral.js";
export { INCEPTION_BASE_URL, createInceptionProvider } from "./inception.js";
export { OLLAMA_DEFAULT_BASE_URL, createOllamaProvider } from "./ollama.js";
export { QWENCLOUD_BASE_URL, createQwenCloudProvider, qwencloudProviderOptions } from "./qwencloud.js";
export { AGENTROUTER_BASE_URL, createAgentRouterProvider, agentrouterProviderOptions } from "./agentrouter.js";

export interface ProviderCredentials {
  anthropicApiKey?: string;
  openaiApiKey?: string;
  geminiApiKey?: string;
  openrouterApiKey?: string;
  orcarouterApiKey?: string;
  groqApiKey?: string;
  cerebrasApiKey?: string;
  githubApiKey?: string;
  mistralApiKey?: string;
  inceptionApiKey?: string;
  ollamaApiKey?: string;
  qwencloudApiKey?: string;
  agentrouterApiKey?: string;
}

export function createProviders(creds: ProviderCredentials, customConfigs: CustomProviderConfig[] = loadCustomProviders()): Record<ProviderId, ModelProvider> {
  const providers: Record<ProviderId, ModelProvider> = {
    anthropic: createAnthropicProvider(creds.anthropicApiKey),
    openai: createOpenAIProvider(creds.openaiApiKey),
    gemini: createGeminiProvider(creds.geminiApiKey),
    openrouter: createOpenRouterProvider(creds.openrouterApiKey),
    orcarouter: createOrcarouterProvider(creds.orcarouterApiKey),
    groq: createGroqProvider(creds.groqApiKey),
    cerebras: createCerebrasProvider(creds.cerebrasApiKey),
    github: createGitHubModelsProvider(creds.githubApiKey),
    mistral: createMistralProvider(creds.mistralApiKey),
    inception: createInceptionProvider(creds.inceptionApiKey),
    ollama: createOllamaProvider(creds.ollamaApiKey),
    qwencloud: createQwenCloudProvider(creds.qwencloudApiKey),
    agentrouter: createAgentRouterProvider(creds.agentrouterApiKey),
  };
  syncCustomProviderModels(customProviderModels(customConfigs));
  for (const config of customConfigs) providers[config.id] = createCustomProvider(config);
  return providers;
}
