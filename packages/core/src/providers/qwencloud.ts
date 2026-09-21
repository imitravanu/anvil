import { ModelProvider } from "./types.js";
import {
  createChatCompletionsStyleProvider,
  type ChatCompletionsStyleProviderOptions,
} from "./openai.js";

export const QWENCLOUD_BASE_URL = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";

export function qwencloudProviderOptions(
  apiKey: string | undefined
): ChatCompletionsStyleProviderOptions {
  return {
    id: "qwencloud",
    displayName: "QwenCloud",
    apiKey,
    baseURL: QWENCLOUD_BASE_URL,
    maxTokensParam: "max_tokens",
    supportsVision: true,
  };
}

export function createQwenCloudProvider(apiKey: string | undefined): ModelProvider {
  return createChatCompletionsStyleProvider(qwencloudProviderOptions(apiKey));
}
