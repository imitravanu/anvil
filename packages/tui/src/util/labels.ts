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
};