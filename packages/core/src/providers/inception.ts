import { ModelProvider } from "./types.js";
import {
  createChatCompletionsStyleProvider,
  type ChatCompletionsStyleProviderOptions,
} from "./openai.js";
import { INCEPTION_MIN_COMPLETION_TOKENS } from "../config/constants.js";

export const INCEPTION_BASE_URL = "https://api.inceptionlabs.ai/v1";

/**
 * The adapter's factory options, exposed so tests can drive the exact same
 * configuration end-to-end (only the baseURL is redirected at a stub).
 */
export function inceptionProviderOptions(
  apiKey: string | undefined
): ChatCompletionsStyleProviderOptions {
  return {
    id: "inception",
    displayName: "Inception",
    apiKey,
    baseURL: INCEPTION_BASE_URL,
    maxTokensParam: "max_tokens",
    // Mercury reasons before it speaks: without this floor a small budget
    // returns an empty length-cutoff turn (proven by live certify 2026-09-21).
    maxTokensFloor: INCEPTION_MIN_COMPLETION_TOKENS,
    supportsVision: false,
  };
}

export function createInceptionProvider(apiKey: string | undefined): ModelProvider {
  return createChatCompletionsStyleProvider(inceptionProviderOptions(apiKey));
}
