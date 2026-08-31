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
    // Live-verified 2026-09: gemini-2.5-pro is no longer available to new
    // users; the API recommends gemini-3.1-pro-preview (not free-tier eligible).
    id: "gemini-3.1-pro-preview",
    providerId: "gemini",
    displayName: "Gemini 3.1 Pro (preview)",
    contextWindow: 1_000_000,
    supportsTools: true,
    supportsVision: true,
  },
  {
    // Live-verified 2026-09 with a free-tier key: streams correctly.
    id: "gemini-3.6-flash",
    providerId: "gemini",
    displayName: "Gemini 3.6 Flash",
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
