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
    // Default Gemini model. Live-verified 2026-09 with a free-tier key:
    // streams correctly. Kept first so the no-settings fallback picks a
    // free-tier-eligible model rather than the pro-preview below.
    id: "gemini-3.6-flash",
    providerId: "gemini",
    displayName: "Gemini 3.6 Flash",
    contextWindow: 1_000_000,
    supportsTools: true,
    supportsVision: true,
    isFree: true,
  },
  {
    // Live-verified 2026-09: gemini-2.5-pro is no longer available to new
    // users; the API recommends gemini-3.1-pro-preview. NOTE: not eligible
    // for the free tier (free-tier quota is 0) — the registry ordering keeps
    // it after gemini-3.6-flash so it is never the implicit default.
    id: "gemini-3.1-pro-preview",
    providerId: "gemini",
    displayName: "Gemini 3.1 Pro (preview)",
    contextWindow: 1_000_000,
    supportsTools: true,
    supportsVision: true,
  },
  // OpenRouter models: free models are listed first so fallback and picker prioritize them.
  {
    id: "openrouter/free",
    providerId: "openrouter",
    displayName: "Free Models Router (Free)",
    contextWindow: 200_000,
    supportsTools: true,
    supportsVision: true,
    isFree: true,
  },
  {
    id: "google/gemma-4-31b-it:free",
    providerId: "openrouter",
    displayName: "Google: Gemma 4 31B (Free)",
    contextWindow: 262_144,
    supportsTools: true,
    supportsVision: true,
    isFree: true,
  },
  {
    id: "google/gemma-4-26b-a4b-it:free",
    providerId: "openrouter",
    displayName: "Google: Gemma 4 26B A4B (Free)",
    contextWindow: 262_144,
    supportsTools: true,
    supportsVision: true,
    isFree: true,
  },
  {
    id: "poolside/laguna-s-2.1:free",
    providerId: "openrouter",
    displayName: "Poolside: Laguna S 2.1 (Free)",
    contextWindow: 262_144,
    supportsTools: true,
    supportsVision: false,
    isFree: true,
  },
  {
    id: "poolside/laguna-xs-2.1:free",
    providerId: "openrouter",
    displayName: "Poolside: Laguna XS 2.1 (Free)",
    contextWindow: 262_144,
    supportsTools: true,
    supportsVision: false,
    isFree: true,
  },
  {
    id: "cohere/north-mini-code:free",
    providerId: "openrouter",
    displayName: "Cohere: North Mini Code (Free)",
    contextWindow: 256_000,
    supportsTools: true,
    supportsVision: false,
    isFree: true,
  },
  {
    id: "z-ai/glm-5.2:free",
    providerId: "openrouter",
    displayName: "Z.ai: GLM 5.2 (Free)",
    contextWindow: 256_000,
    supportsTools: true,
    supportsVision: false,
    isFree: true,
  },
  {
    id: "nvidia/nemotron-3.5-lightning:free",
    providerId: "openrouter",
    displayName: "NVIDIA: Nemotron 3.5 Lightning (Free)",
    contextWindow: 1_000_000,
    supportsTools: true,
    supportsVision: false,
    isFree: true,
  },
  {
    id: "nvidia/nemotron-3-ultra-550b-a55b:free",
    providerId: "openrouter",
    displayName: "NVIDIA: Nemotron 3 Ultra (Free)",
    contextWindow: 1_000_000,
    supportsTools: true,
    supportsVision: false,
    isFree: true,
  },
  {
    id: "nvidia/nemotron-3-super-120b-a12b:free",
    providerId: "openrouter",
    displayName: "NVIDIA: Nemotron 3 Super (Free)",
    contextWindow: 262_144,
    supportsTools: true,
    supportsVision: false,
    isFree: true,
  },
  {
    id: "minimax/minimax-m3:free",
    providerId: "openrouter",
    displayName: "MiniMax: MiniMax M3 (Free)",
    contextWindow: 1_048_576,
    supportsTools: true,
    supportsVision: true,
    isFree: true,
  },
  {
    id: "minimax/minimax-m2.7:free",
    providerId: "openrouter",
    displayName: "MiniMax: MiniMax M2.7 (Free)",
    contextWindow: 196_608,
    supportsTools: true,
    supportsVision: false,
    isFree: true,
  },
  {
    id: "thinkingmachines/inkling:free",
    providerId: "openrouter",
    displayName: "Thinking Machines: Inkling (Free)",
    contextWindow: 1_048_576,
    supportsTools: true,
    supportsVision: true,
    isFree: true,
  },
  {
    id: "thinkingmachines/inkling-small:free",
    providerId: "openrouter",
    displayName: "Thinking Machines: Inkling Small (Free)",
    contextWindow: 1_048_576,
    supportsTools: true,
    supportsVision: true,
    isFree: true,
  },
  {
    id: "dots-studio/dots-3-note-preview:free",
    providerId: "openrouter",
    displayName: "Dots Studio: Dots3-Note Preview (Free)",
    contextWindow: 512_000,
    supportsTools: true,
    supportsVision: true,
    isFree: true,
  },
  {
    id: "inclusionai/ling-3.0-flash-fin:free",
    providerId: "openrouter",
    displayName: "InclusionAI: Ling 3.0 Flash Fin (Free)",
    contextWindow: 262_144,
    supportsTools: true,
    supportsVision: false,
    isFree: true,
  },
  {
    id: "liquid/lfm-2.5-2.6b:free",
    providerId: "openrouter",
    displayName: "LiquidAI: LFM2.5-2.6B (Free)",
    contextWindow: 65_536,
    supportsTools: true,
    supportsVision: false,
    isFree: true,
  },
  {
    id: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
    providerId: "openrouter",
    displayName: "NVIDIA: Nemotron 3 Nano Omni (Free)",
    contextWindow: 256_000,
    supportsTools: true,
    supportsVision: true,
    isFree: true,
  },
  // Paid / credits required models:
  {
    id: "deepseek/deepseek-v3.2",
    providerId: "openrouter",
    displayName: "DeepSeek V3.2 (Paid)",
    contextWindow: 128_000,
    supportsTools: true,
    supportsVision: false,
    isFree: false,
  },
  // Groq models (100% Free Tier, fast LPU inference)
  {
    id: "llama-3.3-70b-versatile",
    providerId: "groq",
    displayName: "Llama 3.3 70B Versatile",
    contextWindow: 128_000,
    supportsTools: true,
    supportsVision: false,
    isFree: true,
  },
  {
    id: "llama-3.1-8b-instant",
    providerId: "groq",
    displayName: "Llama 3.1 8B Instant",
    contextWindow: 128_000,
    supportsTools: true,
    supportsVision: false,
    isFree: true,
  },
  {
    id: "qwen-2.5-coder-32b",
    providerId: "groq",
    displayName: "Qwen 2.5 Coder 32B",
    contextWindow: 128_000,
    supportsTools: true,
    supportsVision: false,
    isFree: true,
  },
  // GitHub Models (Free with GitHub account / Personal Access Token)
  {
    id: "gpt-4o-mini",
    providerId: "github",
    displayName: "GPT-4o mini (via GitHub)",
    contextWindow: 128_000,
    supportsTools: true,
    supportsVision: true,
    isFree: true,
  },
  {
    id: "meta-llama-3.3-70b-instruct",
    providerId: "github",
    displayName: "Llama 3.3 70B (via GitHub)",
    contextWindow: 128_000,
    supportsTools: true,
    supportsVision: false,
    isFree: true,
  },
  {
    id: "mistral-large-2411",
    providerId: "github",
    displayName: "Mistral Large (via GitHub)",
    contextWindow: 128_000,
    supportsTools: true,
    supportsVision: false,
    isFree: true,
  },
  // Cerebras models (1 Million free tokens/day)
  {
    id: "llama3.3-70b",
    providerId: "cerebras",
    displayName: "Llama 3.3 70B",
    contextWindow: 128_000,
    supportsTools: true,
    supportsVision: false,
    isFree: true,
  },
  {
    id: "llama3.1-8b",
    providerId: "cerebras",
    displayName: "Llama 3.1 8B",
    contextWindow: 128_000,
    supportsTools: true,
    supportsVision: false,
    isFree: true,
  },
  // Mistral AI models (Experimentation Free Tier)
  {
    id: "codestral-latest",
    providerId: "mistral",
    displayName: "Codestral Latest",
    contextWindow: 256_000,
    supportsTools: true,
    supportsVision: false,
    isFree: true,
  },
  {
    id: "mistral-small-latest",
    providerId: "mistral",
    displayName: "Mistral Small Latest",
    contextWindow: 128_000,
    supportsTools: true,
    supportsVision: false,
    isFree: true,
  },
  // Ollama models ($0, 100% Local and Offline)
  {
    id: "qwen2.5-coder:latest",
    providerId: "ollama",
    displayName: "Qwen 2.5 Coder (Local)",
    contextWindow: 128_000,
    supportsTools: true,
    supportsVision: false,
    isFree: true,
  },
  {
    id: "llama3.2:latest",
    providerId: "ollama",
    displayName: "Llama 3.2 (Local)",
    contextWindow: 128_000,
    supportsTools: true,
    supportsVision: false,
    isFree: true,
  },
];

export function getModelsForProvider(providerId: string): ModelInfo[] {
  return MODEL_REGISTRY.filter((m) => m.providerId === providerId);
}

export function registerModel(model: ModelInfo): void {
  const idx = MODEL_REGISTRY.findIndex((m) => m.id === model.id);
  if (idx >= 0) {
    MODEL_REGISTRY[idx] = model;
  } else {
    // Insert after the last free model of the provider if it's free
    let lastFreeIdx = -1;
    for (let i = MODEL_REGISTRY.length - 1; i >= 0; i--) {
      const m = MODEL_REGISTRY[i];
      if (m.providerId === model.providerId && m.isFree) {
        lastFreeIdx = i;
        break;
      }
    }
    if (model.isFree && lastFreeIdx !== -1) {
      MODEL_REGISTRY.splice(lastFreeIdx + 1, 0, model);
    } else {
      MODEL_REGISTRY.push(model);
    }
  }
}

export function registerModels(models: ModelInfo[]): void {
  for (const m of models) {
    registerModel(m);
  }
}
