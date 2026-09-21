import { ModelInfo, CertificationStatus } from "./types.js";

// Two indexes: provider-qualified (exact) and id -> first entry. Keying by id
// alone used to let the same id registered under a second provider silently
// overwrite the first one's row (last-wins) — curated built-ins must keep
// priority over live-synced duplicates, and a session asking about its own
// provider's model must get THAT provider's row.
const _qualifiedIndex = new Map<string, ModelInfo>();
const _idFirstIndex = new Map<string, ModelInfo>();

const _key = (providerId: string, id: string): string => `${providerId}:${id}`;

function _reindex(): void {
  _qualifiedIndex.clear();
  _idFirstIndex.clear();
  for (const m of MODEL_REGISTRY) {
    _qualifiedIndex.set(_key(m.providerId, m.id), m);
    if (!_idFirstIndex.has(m.id)) _idFirstIndex.set(m.id, m);
  }
}

export const MODEL_REGISTRY: ModelInfo[] = [
  {
    id: "claude-opus-5",
    providerId: "anthropic",
    displayName: "Claude Opus 5",
    isFree: false,
    contextWindow: 200_000,
    supportsTools: true,
    supportsVision: true,
    certified: "untested",
  },
  {
    id: "claude-sonnet-5",
    providerId: "anthropic",
    displayName: "Claude Sonnet 5",
    isFree: false,
    contextWindow: 200_000,
    supportsTools: true,
    supportsVision: true,
    certified: "live",
    certifiedAt: "2026-09-10T18:00:00.000Z",
    certifiedMode: "mock",
  },
  {
    id: "claude-3-7-sonnet-20250219",
    providerId: "anthropic",
    displayName: "Claude 3.7 Sonnet",
    isFree: false,
    contextWindow: 200_000,
    supportsTools: true,
    supportsVision: true,
    certified: "live",
    certifiedAt: "2026-09-10T18:00:00.000Z",
    certifiedMode: "mock",
  },
  {
    id: "claude-3-5-sonnet-20241022",
    providerId: "anthropic",
    displayName: "Claude 3.5 Sonnet",
    isFree: false,
    contextWindow: 200_000,
    supportsTools: true,
    supportsVision: true,
    certified: "live",
    certifiedAt: "2026-09-10T18:00:00.000Z",
    certifiedMode: "mock",
  },
  {
    id: "claude-3-5-haiku-20241022",
    providerId: "anthropic",
    displayName: "Claude 3.5 Haiku",
    isFree: false,
    contextWindow: 200_000,
    supportsTools: true,
    supportsVision: true,
    certified: "live",
    certifiedAt: "2026-09-10T18:00:00.000Z",
    certifiedMode: "mock",
  },
  {
    id: "gpt-5.1",
    providerId: "openai",
    displayName: "GPT-5.1",
    isFree: false,
    contextWindow: 400_000,
    supportsTools: true,
    supportsVision: true,
    certified: "untested",
  },
  {
    id: "gpt-4o",
    providerId: "openai",
    displayName: "GPT-4o",
    isFree: false,
    contextWindow: 128_000,
    supportsTools: true,
    supportsVision: true,
    certified: "live",
    certifiedAt: "2026-09-10T18:00:00.000Z",
    certifiedMode: "mock",
  },
  {
    id: "gpt-4o-mini",
    providerId: "openai",
    displayName: "GPT-4o mini",
    isFree: false,
    contextWindow: 128_000,
    supportsTools: true,
    supportsVision: true,
    certified: "live",
    certifiedAt: "2026-09-10T18:00:00.000Z",
    certifiedMode: "mock",
  },
  {
    id: "o3-mini",
    providerId: "openai",
    displayName: "o3-mini",
    isFree: false,
    contextWindow: 200_000,
    supportsTools: true,
    supportsVision: false,
    certified: "live",
    certifiedAt: "2026-09-10T18:00:00.000Z",
    certifiedMode: "mock",
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
    certified: "live",
    certifiedAt: "2026-09-18T00:00:00.000Z",
    certifiedMode: "live",
  },
  {
    id: "gemini-2.0-flash",
    providerId: "gemini",
    displayName: "Gemini 2.0 Flash",
    contextWindow: 1_048_576,
    supportsTools: true,
    supportsVision: true,
    isFree: true,
    // Live-probed 2026-09-18: the API answers "This model models/gemini-2.0-flash
    // is no longer available. Please update your code to use models/gemini-3.6-flash".
    // Certification rots — the 2026-09-10 "live" result stopped being true when
    // Google retired the id. Prefer gemini-3.6-flash.
    certified: "broken",
    certifiedAt: "2026-09-18T00:00:00.000Z",
    certifiedMode: "live",
  },
  {
    id: "gemini-1.5-pro",
    providerId: "gemini",
    displayName: "Gemini 1.5 Pro",
    isFree: false,
    contextWindow: 2_097_152,
    supportsTools: true,
    supportsVision: true,
    certified: "live",
    certifiedAt: "2026-09-10T18:00:00.000Z",
    certifiedMode: "mock",
  },
  {
    id: "gemini-1.5-flash",
    providerId: "gemini",
    displayName: "Gemini 1.5 Flash",
    contextWindow: 1_048_576,
    supportsTools: true,
    supportsVision: true,
    isFree: true,
    certified: "live",
    certifiedAt: "2026-09-10T18:00:00.000Z",
    certifiedMode: "mock",
  },
  {
    // Live-verified 2026-09: gemini-2.5-pro is no longer available to new
    // users; the API recommends gemini-3.1-pro-preview. NOTE: not eligible
    // for the free tier (free-tier quota is 0) — the registry ordering keeps
    // it after gemini-3.6-flash so it is never the implicit default.
    id: "gemini-3.1-pro-preview",
    providerId: "gemini",
    displayName: "Gemini 3.1 Pro (preview)",
    isFree: false,
    contextWindow: 1_000_000,
    supportsTools: true,
    supportsVision: true,
    certified: "live",
    certifiedAt: "2026-09-10T18:00:00.000Z",
    certifiedMode: "mock",
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
    certified: "live",
    certifiedAt: "2026-09-10T18:00:00.000Z",
    certifiedMode: "mock",
  },
  {
    id: "google/gemma-4-31b-it:free",
    providerId: "openrouter",
    displayName: "Google: Gemma 4 31B (Free)",
    contextWindow: 262_144,
    supportsTools: true,
    supportsVision: true,
    isFree: true,
    certified: "live",
    certifiedAt: "2026-09-10T18:00:00.000Z",
    certifiedMode: "mock",
  },
  {
    id: "google/gemma-4-26b-a4b-it:free",
    providerId: "openrouter",
    displayName: "Google: Gemma 4 26B A4B (Free)",
    contextWindow: 262_144,
    supportsTools: true,
    supportsVision: true,
    isFree: true,
    certified: "live",
    certifiedAt: "2026-09-10T18:00:00.000Z",
    certifiedMode: "mock",
  },
  {
    id: "poolside/laguna-s-2.1:free",
    providerId: "openrouter",
    displayName: "Poolside: Laguna S 2.1 (Free)",
    contextWindow: 262_144,
    supportsTools: true,
    supportsVision: false,
    isFree: true,
    certified: "live",
    certifiedAt: "2026-09-10T18:00:00.000Z",
    certifiedMode: "mock",
  },
  {
    id: "poolside/laguna-xs-2.1:free",
    providerId: "openrouter",
    displayName: "Poolside: Laguna XS 2.1 (Free)",
    contextWindow: 262_144,
    supportsTools: true,
    supportsVision: false,
    isFree: true,
    certified: "live",
    certifiedAt: "2026-09-10T18:00:00.000Z",
    certifiedMode: "mock",
  },
  {
    id: "cohere/north-mini-code:free",
    providerId: "openrouter",
    displayName: "Cohere: North Mini Code (Free)",
    contextWindow: 256_000,
    supportsTools: true,
    supportsVision: false,
    isFree: true,
    certified: "live",
    certifiedAt: "2026-09-10T18:00:00.000Z",
    certifiedMode: "mock",
  },
  {
    id: "z-ai/glm-5.2:free",
    providerId: "openrouter",
    displayName: "Z.ai: GLM 5.2 (Free)",
    contextWindow: 256_000,
    supportsTools: true,
    supportsVision: false,
    isFree: true,
    certified: "live",
    certifiedAt: "2026-09-10T18:00:00.000Z",
    certifiedMode: "mock",
  },
  {
    id: "nvidia/nemotron-3.5-lightning:free",
    providerId: "openrouter",
    displayName: "NVIDIA: Nemotron 3.5 Lightning (Free)",
    contextWindow: 1_000_000,
    supportsTools: true,
    supportsVision: false,
    isFree: true,
    certified: "live",
    certifiedAt: "2026-09-10T18:00:00.000Z",
    certifiedMode: "mock",
  },
  {
    id: "nvidia/nemotron-3-ultra-550b-a55b:free",
    providerId: "openrouter",
    displayName: "NVIDIA: Nemotron 3 Ultra (Free)",
    contextWindow: 1_000_000,
    supportsTools: true,
    supportsVision: false,
    isFree: true,
    certified: "live",
    certifiedAt: "2026-09-10T18:00:00.000Z",
    certifiedMode: "mock",
  },
  {
    id: "nvidia/nemotron-3-super-120b-a12b:free",
    providerId: "openrouter",
    displayName: "NVIDIA: Nemotron 3 Super (Free)",
    contextWindow: 262_144,
    supportsTools: true,
    supportsVision: false,
    isFree: true,
    certified: "live",
    certifiedAt: "2026-09-10T18:00:00.000Z",
    certifiedMode: "mock",
  },
  {
    id: "minimax/minimax-m3:free",
    providerId: "openrouter",
    displayName: "MiniMax: MiniMax M3 (Free)",
    contextWindow: 1_048_576,
    supportsTools: true,
    supportsVision: true,
    isFree: true,
    certified: "live",
    certifiedAt: "2026-09-10T18:00:00.000Z",
    certifiedMode: "mock",
  },
  {
    id: "minimax/minimax-m2.7:free",
    providerId: "openrouter",
    displayName: "MiniMax: MiniMax M2.7 (Free)",
    contextWindow: 196_608,
    supportsTools: true,
    supportsVision: false,
    isFree: true,
    certified: "live",
    certifiedAt: "2026-09-10T18:00:00.000Z",
    certifiedMode: "mock",
  },
  {
    id: "thinkingmachines/inkling:free",
    providerId: "openrouter",
    displayName: "Thinking Machines: Inkling (Free)",
    contextWindow: 1_048_576,
    supportsTools: true,
    supportsVision: true,
    isFree: true,
    certified: "live",
    certifiedAt: "2026-09-10T18:00:00.000Z",
    certifiedMode: "mock",
  },
  {
    id: "thinkingmachines/inkling-small:free",
    providerId: "openrouter",
    displayName: "Thinking Machines: Inkling Small (Free)",
    contextWindow: 1_048_576,
    supportsTools: true,
    supportsVision: true,
    isFree: true,
    certified: "live",
    certifiedAt: "2026-09-10T18:00:00.000Z",
    certifiedMode: "mock",
  },
  {
    id: "dots-studio/dots-3-note-preview:free",
    providerId: "openrouter",
    displayName: "Dots Studio: Dots3-Note Preview (Free)",
    contextWindow: 512_000,
    supportsTools: true,
    supportsVision: true,
    isFree: true,
    certified: "live",
    certifiedAt: "2026-09-10T18:00:00.000Z",
    certifiedMode: "mock",
  },
  {
    id: "inclusionai/ling-3.0-flash-fin:free",
    providerId: "openrouter",
    displayName: "InclusionAI: Ling 3.0 Flash Fin (Free)",
    contextWindow: 262_144,
    supportsTools: true,
    supportsVision: false,
    isFree: true,
    certified: "live",
    certifiedAt: "2026-09-10T18:00:00.000Z",
    certifiedMode: "mock",
  },
  {
    id: "liquid/lfm-2.5-2.6b:free",
    providerId: "openrouter",
    displayName: "LiquidAI: LFM2.5-2.6B (Free)",
    contextWindow: 65_536,
    supportsTools: true,
    supportsVision: false,
    isFree: true,
    certified: "live",
    certifiedAt: "2026-09-10T18:00:00.000Z",
    certifiedMode: "mock",
  },
  {
    id: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
    providerId: "openrouter",
    displayName: "NVIDIA: Nemotron 3 Nano Omni (Free)",
    contextWindow: 256_000,
    supportsTools: true,
    supportsVision: true,
    isFree: true,
    certified: "live",
    certifiedAt: "2026-09-10T18:00:00.000Z",
    certifiedMode: "mock",
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
    certified: "live",
    certifiedAt: "2026-09-10T18:00:00.000Z",
    certifiedMode: "mock",
  },
  // Orcarouter models: free-only policy — the source reads the public
  // pricing catalog's is_free_tier flag, so paid models never enter the
  // registry (live-verified 2026-09: fusion/auto family is paid and stays
  // hidden; Qwen3.8 27B was DELISTED and replaced by GLM 5.3 Flash — sync
  // auto-demotes it to (Paid) on next refresh).
  {
    id: "z-ai/glm-5.3-flash-free",
    providerId: "orcarouter",
    displayName: "Z.ai: GLM 5.3 Flash (Free)",
    contextWindow: 1_000_000,
    supportsTools: true,
    supportsVision: true,
    isFree: true,
    certified: "live",
    certifiedAt: "2026-09-10T18:00:00.000Z",
    certifiedMode: "mock",
  },
  {
    id: "deepseek/deepseek-v4-flash-free",
    providerId: "orcarouter",
    displayName: "DeepSeek: DeepSeek V4 Flash (Free)",
    contextWindow: 1_048_576,
    supportsTools: true,
    supportsVision: false,
    isFree: true,
    certified: "live",
    certifiedAt: "2026-09-10T18:00:00.000Z",
    certifiedMode: "mock",
  },
  {
    id: "tencent/hy3-free",
    providerId: "orcarouter",
    displayName: "Tencent: Hy3 (Free)",
    contextWindow: 262_144,
    supportsTools: true,
    supportsVision: false,
    isFree: true,
    certified: "live",
    certifiedAt: "2026-09-10T18:00:00.000Z",
    certifiedMode: "mock",
  },
  {
    id: "orcarouter/free",
    providerId: "orcarouter",
    displayName: "Free Models Router (Free)",
    contextWindow: 128_000,
    supportsTools: true,
    supportsVision: false,
    isFree: true,
    certified: "live",
    certifiedAt: "2026-09-10T18:00:00.000Z",
    certifiedMode: "mock",
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
    certified: "live",
    certifiedAt: "2026-09-10T18:00:00.000Z",
    certifiedMode: "mock",
  },
  {
    id: "llama-3.1-8b-instant",
    providerId: "groq",
    displayName: "Llama 3.1 8B Instant",
    contextWindow: 128_000,
    supportsTools: true,
    supportsVision: false,
    isFree: true,
    certified: "live",
    certifiedAt: "2026-09-10T18:00:00.000Z",
    certifiedMode: "mock",
  },
  {
    id: "qwen-2.5-coder-32b",
    providerId: "groq",
    displayName: "Qwen 2.5 Coder 32B",
    contextWindow: 128_000,
    supportsTools: true,
    supportsVision: false,
    isFree: true,
    certified: "live",
    certifiedAt: "2026-09-10T18:00:00.000Z",
    certifiedMode: "mock",
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
    certified: "live",
    certifiedAt: "2026-09-10T18:00:00.000Z",
    certifiedMode: "mock",
  },
  {
    id: "meta-llama-3.3-70b-instruct",
    providerId: "github",
    displayName: "Llama 3.3 70B (via GitHub)",
    contextWindow: 128_000,
    supportsTools: true,
    supportsVision: false,
    isFree: true,
    certified: "live",
    certifiedAt: "2026-09-10T18:00:00.000Z",
    certifiedMode: "mock",
  },
  {
    id: "mistral-large-2411",
    providerId: "github",
    displayName: "Mistral Large (via GitHub)",
    contextWindow: 128_000,
    supportsTools: true,
    supportsVision: false,
    isFree: true,
    certified: "live",
    certifiedAt: "2026-09-10T18:00:00.000Z",
    certifiedMode: "mock",
  },
  // Cerebras models (1 Million free tokens/day)
  {
    id: "llama3.3-70b",
    providerId: "cerebras",
    displayName: "Llama 3.3 70B (via Cerebras)",
    contextWindow: 128_000,
    supportsTools: true,
    supportsVision: false,
    isFree: true,
    certified: "live",
    certifiedAt: "2026-09-10T18:00:00.000Z",
    certifiedMode: "mock",
  },
  {
    id: "llama3.1-8b",
    providerId: "cerebras",
    displayName: "Llama 3.1 8B (via Cerebras)",
    contextWindow: 128_000,
    supportsTools: true,
    supportsVision: false,
    isFree: true,
    certified: "live",
    certifiedAt: "2026-09-10T18:00:00.000Z",
    certifiedMode: "mock",
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
    certified: "live",
    certifiedAt: "2026-09-10T18:00:00.000Z",
    certifiedMode: "mock",
  },
  {
    id: "mistral-small-latest",
    providerId: "mistral",
    displayName: "Mistral Small Latest",
    contextWindow: 128_000,
    supportsTools: true,
    supportsVision: false,
    isFree: true,
    certified: "live",
    certifiedAt: "2026-09-10T18:00:00.000Z",
    certifiedMode: "mock",
  },
  // Inception models (Mercury diffusion LLMs; 100M free trial tokens per account)
  {
    id: "mercury-2.5",
    providerId: "inception",
    displayName: "Mercury 2.5",
    contextWindow: 260_000,
    supportsTools: true,
    supportsVision: false,
    isFree: true,
    // Live-certified 2026-09-21: 5/5 criteria (streaming, tool round-trip,
    // 3-turn memory, error path, rate-limit) via the native adapter with the
    // reasoning token floor. Probe evidence in PROGRESS.md.
    certified: "live",
    certifiedAt: "2026-09-21T13:08:25.000Z",
    certifiedMode: "live",
  },
  {
    id: "mercury-2",
    providerId: "inception",
    displayName: "Mercury 2",
    contextWindow: 128_000,
    supportsTools: true,
    supportsVision: false,
    isFree: true,
    certified: "untested",
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
    certified: "live",
    certifiedAt: "2026-09-10T18:00:00.000Z",
    certifiedMode: "mock",
  },
  {
    id: "llama3.2:latest",
    providerId: "ollama",
    displayName: "Llama 3.2 (Local)",
    contextWindow: 128_000,
    supportsTools: true,
    supportsVision: false,
    isFree: true,
    certified: "live",
    certifiedAt: "2026-09-10T18:00:00.000Z",
    certifiedMode: "mock",
  },
  // QwenCloud (Alibaba Cloud DashScope Compatible)
  {
    id: "qwen3.8-max",
    providerId: "qwencloud",
    displayName: "Qwen 3.8 Max (Flagship)",
    contextWindow: 1_000_000,
    supportsTools: true,
    supportsVision: false,
    isFree: true,
    certified: "untested",
  },
  {
    id: "qwen3.8-flash",
    providerId: "qwencloud",
    displayName: "Qwen 3.8 Flash (1M Ctx)",
    contextWindow: 1_000_000,
    supportsTools: true,
    supportsVision: false,
    isFree: true,
    certified: "untested",
  },
  {
    id: "qwq-plus",
    providerId: "qwencloud",
    displayName: "QwQ Plus (Reasoning)",
    contextWindow: 128_000,
    supportsTools: true,
    supportsVision: false,
    isFree: true,
    certified: "untested",
  },
  {
    id: "qwen3-coder-plus",
    providerId: "qwencloud",
    displayName: "Qwen 3 Coder Plus",
    contextWindow: 128_000,
    supportsTools: true,
    supportsVision: false,
    isFree: true,
    certified: "untested",
  },
  {
    id: "qwen3-coder-flash",
    providerId: "qwencloud",
    displayName: "Qwen 3 Coder Flash",
    contextWindow: 128_000,
    supportsTools: true,
    supportsVision: false,
    isFree: true,
    certified: "untested",
  },
  {
    id: "deepseek-v4.1-flash",
    providerId: "qwencloud",
    displayName: "DeepSeek V4.1 Flash",
    contextWindow: 128_000,
    supportsTools: true,
    supportsVision: false,
    isFree: true,
    certified: "untested",
  },
  {
    id: "deepseek-v4-pro",
    providerId: "qwencloud",
    displayName: "DeepSeek V4 Pro",
    contextWindow: 128_000,
    supportsTools: true,
    supportsVision: false,
    isFree: true,
    certified: "untested",
  },
  {
    id: "deepseek-v4-flash",
    providerId: "qwencloud",
    displayName: "DeepSeek V4 Flash",
    contextWindow: 128_000,
    supportsTools: true,
    supportsVision: false,
    isFree: true,
    certified: "untested",
  },
  {
    id: "deepseek-v3.2",
    providerId: "qwencloud",
    displayName: "DeepSeek V3.2",
    contextWindow: 128_000,
    supportsTools: true,
    supportsVision: false,
    isFree: true,
    certified: "untested",
  },
  {
    id: "glm-5.3",
    providerId: "qwencloud",
    displayName: "GLM 5.3",
    contextWindow: 128_000,
    supportsTools: true,
    supportsVision: false,
    isFree: true,
    certified: "untested",
  },
  {
    id: "kimi-k3",
    providerId: "qwencloud",
    displayName: "Kimi K3",
    contextWindow: 128_000,
    supportsTools: true,
    supportsVision: false,
    isFree: true,
    certified: "untested",
  },
  {
    id: "kimi-k2.7-code",
    providerId: "qwencloud",
    displayName: "Kimi K2.7 Code",
    contextWindow: 128_000,
    supportsTools: true,
    supportsVision: false,
    isFree: true,
    certified: "untested",
  },
  {
    id: "qwen3.7-max",
    providerId: "qwencloud",
    displayName: "Qwen 3.7 Max",
    contextWindow: 128_000,
    supportsTools: true,
    supportsVision: false,
    isFree: true,
    certified: "untested",
  },
  {
    id: "qwen3.7-plus",
    providerId: "qwencloud",
    displayName: "Qwen 3.7 Plus",
    contextWindow: 128_000,
    supportsTools: true,
    supportsVision: false,
    isFree: true,
    certified: "untested",
  },
  {
    id: "qwen-max",
    providerId: "qwencloud",
    displayName: "Qwen Max",
    contextWindow: 128_000,
    supportsTools: true,
    supportsVision: false,
    isFree: true,
    certified: "untested",
  },
  {
    id: "qwen-plus",
    providerId: "qwencloud",
    displayName: "Qwen Plus",
    contextWindow: 128_000,
    supportsTools: true,
    supportsVision: false,
    isFree: true,
    certified: "untested",
  },
  {
    id: "qwen-turbo",
    providerId: "qwencloud",
    displayName: "Qwen Turbo",
    contextWindow: 128_000,
    supportsTools: true,
    supportsVision: false,
    isFree: true,
    certified: "untested",
  },
  {
    id: "qwen-vl-max",
    providerId: "qwencloud",
    displayName: "Qwen VL Max",
    contextWindow: 128_000,
    supportsTools: true,
    supportsVision: true,
    isFree: true,
    certified: "untested",
  },
  {
    id: "qwen3-vl-plus",
    providerId: "qwencloud",
    displayName: "Qwen 3 VL Plus",
    contextWindow: 128_000,
    supportsTools: true,
    supportsVision: true,
    isFree: true,
    certified: "untested",
  },
  {
    id: "qwen3-vl-flash",
    providerId: "qwencloud",
    displayName: "Qwen 3 VL Flash",
    contextWindow: 128_000,
    supportsTools: true,
    supportsVision: true,
    isFree: true,
    certified: "untested",
  },
  {
    id: "qwen-flash",
    providerId: "qwencloud",
    displayName: "Qwen Flash",
    contextWindow: 128_000,
    supportsTools: true,
    supportsVision: false,
    isFree: true,
    certified: "untested",
  },
  {
    id: "glm-5.2",
    providerId: "qwencloud",
    displayName: "GLM 5.2",
    contextWindow: 128_000,
    supportsTools: true,
    supportsVision: false,
    isFree: true,
    certified: "untested",
  },
];

export function getModelsForProvider(providerId: string): ModelInfo[] {
  return MODEL_REGISTRY.filter((m) => m.providerId === providerId);
}

export function registerModel(model: ModelInfo): void {
  // Replace only the SAME provider's entry for that id — a cross-provider id
  // collision must not overwrite the other provider's row.
  const idx = MODEL_REGISTRY.findIndex(
    (m) => m.providerId === model.providerId && m.id === model.id
  );
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
  _reindex();
}

export function getModel(id: string, providerId?: string): ModelInfo | undefined {
  if (providerId) {
    // Qualified miss returns undefined — NEVER another provider's row. The
    // old fallback fed the wrong contextWindow/flags into compaction and let
    // certification mutate the wrong row (e.g. openrouter's gpt-4o-mini
    // reading the openai row).
    return _qualifiedIndex.get(_key(providerId, id));
  }
  return _idFirstIndex.get(id);
}

export function registerModels(models: ModelInfo[]): void {
  for (const m of models) {
    registerModel(m);
  }
}

/**
 * Remove models by id. Used by tests to keep the registry pristine after
 * registering synthetic phase-8 free models; not part of the hot path.
 */
export function unregisterModels(ids: string[]): void {
  const set = new Set(ids);
  for (let i = MODEL_REGISTRY.length - 1; i >= 0; i--) {
    if (set.has(MODEL_REGISTRY[i].id)) {
      MODEL_REGISTRY.splice(i, 1);
    }
  }
  _reindex();
}

/**
 * Registry view for pickers: free models only. Paid entries (isFree === false)
 * are auto-hidden everywhere a user chooses a model — zero clutter, no
 * [PAID] rows, no navigation cost. Lookups elsewhere (StatusBar, format,
 * Header) keep using the full MODEL_REGISTRY so a paid default chosen via
 * --model still renders its metadata correctly.
 */
export function visibleModels(): ModelInfo[] {
  return MODEL_REGISTRY.filter((m) => m.isFree !== false);
}

export function setModelCertification(
  id: string,
  providerId: string,
  status: CertificationStatus,
  certifiedAt?: string,
  mode?: "mock" | "live"
): boolean {
  const model = getModel(id, providerId);
  if (!model) return false;
  model.certified = status;
  model.certifiedAt = certifiedAt ?? new Date().toISOString();
  // Only overwrite when a mode is supplied: a caller that just flips the status
  // must not erase a recorded live probe's provenance.
  if (mode) model.certifiedMode = mode;
  return true;
}

export function getLatestCertificationDate(): string | null {
  let latest: string | null = null;
  for (const m of MODEL_REGISTRY) {
    if (m.certifiedAt) {
      if (!latest || m.certifiedAt > latest) {
        latest = m.certifiedAt;
      }
    }
  }
  return latest;
}

export function getModelsByCertification(status: CertificationStatus): ModelInfo[] {
  return MODEL_REGISTRY.filter((m) => (m.certified ?? "untested") === status);
}

_reindex();

