import { ModelInfo } from "./types.js";

export const MODEL_REGISTRY: ModelInfo[] = [
  {
    id: "claude-opus-5",
    providerId: "anthropic",
    displayName: "Claude Opus 5",
    contextWindow: 200_000,
    supportsTools: true,
    supportsVision: true,
  },
  {
    id: "claude-sonnet-5",
    providerId: "anthropic",
    displayName: "Claude Sonnet 5",
    contextWindow: 200_000,
    supportsTools: true,
    supportsVision: true,
  },
  {
    id: "gpt-5.1",
    providerId: "openai",
    displayName: "GPT-5.1",
    contextWindow: 400_000,
    supportsTools: true,
    supportsVision: true,
  },
  {
    id: "gemini-2.5-pro",
    providerId: "gemini",
    displayName: "Gemini 2.5 Pro",
    contextWindow: 1_000_000,
    supportsTools: true,
    supportsVision: true,
  },
  // OpenRouter model ids are "vendor/model" — add whichever you want surfaced by default.
  {
    id: "deepseek/deepseek-v3.2",
    providerId: "openrouter",
    displayName: "DeepSeek V3.2 (via OpenRouter)",
    contextWindow: 128_000,
    supportsTools: true,
    supportsVision: false,
  },
];

export function getModelsForProvider(providerId: string): ModelInfo[] {
  return MODEL_REGISTRY.filter((m) => m.providerId === providerId);
}
