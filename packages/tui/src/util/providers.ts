import type { ProviderCredentials, ProviderId } from "@anvil/core";
import { PROVIDER_LABELS } from "./labels.js";

/**
 * Single provider table (P2 unification): short chrome labels live in
 * labels.ts; marketing/onboarding copy + credential wiring live here.
 * FirstRunSetup renders from this — no more copy drift between /connect
 * and the rest of the chrome.
 */
export interface ProviderMeta {
  id: ProviderId;
  /** Short label for chrome (Header/StatusBar/pickers). */
  shortLabel: string;
  /** Marketing label for the connect flow. */
  marketLabel: string;
  field: keyof ProviderCredentials;
  placeholder?: string;
}

export const PROVIDER_META: ProviderMeta[] = [
  { id: "anthropic", shortLabel: PROVIDER_LABELS.anthropic, marketLabel: "Anthropic", field: "anthropicApiKey" },
  { id: "openai", shortLabel: PROVIDER_LABELS.openai, marketLabel: "OpenAI", field: "openaiApiKey" },
  { id: "gemini", shortLabel: PROVIDER_LABELS.gemini, marketLabel: "Google Gemini (Free Tier)", field: "geminiApiKey" },
  { id: "openrouter", shortLabel: PROVIDER_LABELS.openrouter, marketLabel: "OpenRouter (Free Models)", field: "openrouterApiKey" },
  { id: "groq", shortLabel: PROVIDER_LABELS.groq, marketLabel: "Groq (100% Free & Blazing Fast)", field: "groqApiKey", placeholder: "gsk_..." },
  { id: "github", shortLabel: PROVIDER_LABELS.github, marketLabel: "GitHub Models (Free GPT-4o-mini with PAT)", field: "githubApiKey", placeholder: "ghp_..." },
  { id: "cerebras", shortLabel: PROVIDER_LABELS.cerebras, marketLabel: "Cerebras (1M Free Tokens/day)", field: "cerebrasApiKey", placeholder: "csk_..." },
  { id: "mistral", shortLabel: PROVIDER_LABELS.mistral, marketLabel: "Mistral AI / Codestral (Free Tier)", field: "mistralApiKey" },
  { id: "ollama", shortLabel: PROVIDER_LABELS.ollama, marketLabel: "Ollama (Local $0 Offline - localhost:11434)", field: "ollamaApiKey", placeholder: "Enter to connect" },
];
