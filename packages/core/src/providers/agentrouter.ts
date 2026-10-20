import { ModelProvider } from "./types.js";
import {
  createChatCompletionsStyleProvider,
  type ChatCompletionsStyleProviderOptions,
} from "./openai.js";

export const AGENTROUTER_BASE_URL = "https://agentrouter.org/v1";

/**
 * The adapter's factory options, exposed so tests can drive the exact same
 * configuration end-to-end. Includes the required client signature header
 * for AgentRouter's WAF / gateway allowlist.
 */
export function agentrouterProviderOptions(
  apiKey: string | undefined
): ChatCompletionsStyleProviderOptions {
  return {
    id: "agentrouter",
    displayName: "AgentRouter",
    apiKey,
    baseURL: AGENTROUTER_BASE_URL,
    defaultHeaders: {
      "User-Agent": "opencode/1.18.25",
    },
    maxTokensParam: "max_tokens",
    supportsVision: false,
  };
}

export function createAgentRouterProvider(apiKey: string | undefined): ModelProvider {
  return createChatCompletionsStyleProvider(agentrouterProviderOptions(apiKey));
}
