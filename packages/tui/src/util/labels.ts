import type { ModelProvider, ProviderId } from "@imitravanu/anvil-core";

// Single source of truth for human provider names (used in chrome, pickers,
// and /connect). — previously defined inside App.tsx.
export const PROVIDER_LABELS: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  gemini: "Google Gemini",
  openrouter: "OpenRouter",
  orcarouter: "Orcarouter",
  groq: "Groq",
  github: "GitHub Models",
  cerebras: "Cerebras",
  mistral: "Mistral AI",
  inception: "Inception",
  ollama: "Ollama",
  qwencloud: "QwenCloud",
  agentrouter: "AgentRouter",
};

export function refreshCustomProviderLabels(providers: Record<ProviderId, ModelProvider>): void {
  for (const id of Object.keys(PROVIDER_LABELS)) {
    if (id.startsWith("custom:")) delete PROVIDER_LABELS[id];
  }
  for (const provider of Object.values(providers)) {
    if (provider.id.startsWith("custom:")) PROVIDER_LABELS[provider.id] = provider.displayName;
  }
}
