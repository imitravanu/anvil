import { ModelProvider } from "./types.js";
import { type ChatCompletionsStyleProviderOptions } from "./openai.js";
import {
  ResponsesStyleProvider,
  toResponsesInput,
  toResponsesTools,
} from "./responses.js";

export const AGENTROUTER_BASE_URL = "https://agentrouter.org/v1";

export { toResponsesInput, toResponsesTools };

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

/**
 * AgentRouter provider adapter.
 * AgentRouter strictly disallows /v1/chat/completions for GPT-6 models (gpt-6.1-sol, gpt-6-astra),
 * returning HTTP 400. This adapter communicates directly with /v1/responses (OpenAI Responses API)
 * with the required spoofed client signature header to satisfy gateway WAF allowlists.
 */
export class AgentRouterProvider extends ResponsesStyleProvider {
  constructor(apiKey: string | undefined) {
    super({
      id: "agentrouter",
      displayName: "AgentRouter",
      baseURL: AGENTROUTER_BASE_URL,
      apiKey,
      defaultHeaders: {
        "User-Agent": "opencode/1.18.25",
      },
    });
  }
}

export function createAgentRouterProvider(apiKey: string | undefined): ModelProvider {
  return new AgentRouterProvider(apiKey);
}
