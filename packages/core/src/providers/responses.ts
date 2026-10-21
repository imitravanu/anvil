import { getErrorMessage } from "../errors.js";
import {
  CompletionRequest,
  ConversationMessage,
  ModelProvider,
  ProviderId,
  StreamEvent,
  ToolDefinition,
} from "./types.js";
import { parseToolCallJson } from "./streaming.js";
import { BaseProvider } from "./base.js";

/**
 * Translates Anvil conversation messages to the OpenAI Responses API input format (/v1/responses).
 */
export function toResponsesInput(
  messages: ConversationMessage[]
): Array<Record<string, unknown>> {
  const declaredIds = new Set<string>();
  for (const m of messages) {
    for (const c of m.content) {
      if (c.type === "tool_call") declaredIds.add(c.call.id);
    }
  }

  const items: Array<Record<string, unknown>> = [];

  for (const m of messages) {
    if (m.role === "assistant") {
      const text = m.content
        .filter((c) => c.type === "text")
        .map((c) => (c as { text: string }).text)
        .join("");
      if (text) {
        items.push({
          role: "assistant",
          content: [{ type: "output_text", text }],
        });
      }
      const calls = m.content.filter((c) => c.type === "tool_call");
      for (const c of calls) {
        const call = (c as { call: { id: string; name: string; input: unknown } }).call;
        items.push({
          type: "function_call",
          call_id: call.id,
          name: call.name,
          arguments:
            typeof call.input === "string" ? call.input : JSON.stringify(call.input ?? {}),
        });
      }
    } else {
      // Tool results preceding user text
      for (const c of m.content) {
        if (c.type === "tool_result") {
          if (!declaredIds.has(c.result.toolCallId)) continue;
          items.push({
            type: "function_call_output",
            call_id: c.result.toolCallId,
            output: c.result.content,
          });
        }
      }

      const text = m.content
        .filter((c) => c.type === "text")
        .map((c) => (c as { text: string }).text)
        .join("");
      const images = m.content.filter(c => c.type === "image");
      if (images.length) {
        items.push({ role: "user", content: [
          ...(text ? [{ type: "input_text", text }] : []),
          ...images.map(c => ({ type: "input_image", image_url: `data:${c.mediaType};base64,${c.data}` })),
        ] });
      } else if (text) {
        items.push({
          role: "user",
          content: text,
        });
      }
    }
  }
  return items;
}

export function toResponsesTools(tools: ToolDefinition[]): Array<Record<string, unknown>> {
  return tools.map((t) => ({
    type: "function",
    name: t.name,
    description: t.description,
    parameters: t.inputSchema,
  }));
}

export interface ResponsesStyleProviderOptions {
  id: ProviderId;
  displayName: string;
  baseURL: string;
  apiKey: string | undefined;
  defaultHeaders?: Record<string, string>;
}

/**
 * Provider adapter for gateways and endpoints implementing the OpenAI Responses API (/v1/responses).
 */
export class ResponsesStyleProvider extends BaseProvider {
  readonly id: ProviderId;
  readonly displayName: string;
  private readonly baseURL: string;
  private readonly apiKey: string | undefined;
  private readonly defaultHeaders?: Record<string, string>;

  constructor(opts: ResponsesStyleProviderOptions) {
    super();
    this.id = opts.id;
    this.displayName = opts.displayName;
    this.baseURL = opts.baseURL.replace(/\/+$/, "");
    this.apiKey = opts.apiKey;
    this.defaultHeaders = opts.defaultHeaders;
  }

  isConfigured(): boolean {
    return !!this.apiKey;
  }

  protected async *doStream(request: CompletionRequest): AsyncGenerator<StreamEvent> {
    if (!this.apiKey) {
      throw new Error(`${this.displayName} API key not configured.`);
    }

    const url = `${this.baseURL}/responses`;
    const body: Record<string, unknown> = {
      model: request.model,
      stream: true,
      input: toResponsesInput(request.messages),
    };

    if (request.systemPrompt && request.systemPrompt.trim()) {
      body.instructions = request.systemPrompt;
    }
    if (request.tools.length > 0) {
      body.tools = toResponsesTools(request.tools);
    }
    if (request.maxTokens > 0) {
      body.max_output_tokens = request.maxTokens;
    }

    const headers: Record<string, string> = {
      ...(this.apiKey && this.apiKey !== "anvil-no-auth"
        ? { Authorization: `Bearer ${this.apiKey}` }
        : {}),
      "Content-Type": "application/json",
      ...this.defaultHeaders,
    };
    if (this.defaultHeaders && "Authorization" in this.defaultHeaders && !this.defaultHeaders.Authorization) {
      delete headers.Authorization;
    }

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: request.signal,
      redirect: "error",
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMsg = `HTTP ${response.status} ${response.statusText}`;
      try {
        const parsed = JSON.parse(errorText);
        if (parsed.error?.message) {
          errorMsg = parsed.error.message;
        }
      } catch {
        // intentional: fallback to raw response text when error body is not JSON
        if (errorText) errorMsg = errorText;
      }
      const error = new Error(errorMsg);
      (error as unknown as { status: number }).status = response.status;
      throw error;
    }

    if (!response.body) {
      throw new Error(`No response body received from ${this.displayName}.`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let currentEvent = "";
    let hasToolCalls = false;
    const functionCalls = new Map<string, { id: string; name: string; args: string }>();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line) {
            currentEvent = "";
            continue;
          }
          if (line.startsWith("event:")) {
            currentEvent = line.slice(6).trim();
            continue;
          }
          if (line.startsWith("data:")) {
            const dataStr = line.slice(5).trim();
            if (!dataStr || dataStr === "[DONE]") continue;

            let data: Record<string, unknown>;
            try {
              data = JSON.parse(dataStr);
            } catch {
              // intentional: skip non-JSON SSE data frames
              continue;
            }

            if (data.type === "error" || currentEvent === "error") {
              const errObj = (data.error ?? data) as { message?: string };
              yield {
                type: "error",
                message: errObj.message || `${this.displayName} error`,
              };
              return;
            }

            if (data.type === "response.failed" || currentEvent === "response.failed") {
              const resp = data.response as { error?: { message?: string } } | undefined;
              if (resp?.error?.message) {
                yield {
                  type: "error",
                  message: resp.error.message,
                };
                return;
              }
              // intentional: wait for subsequent error frame containing specific details
              continue;
            }

            // Reasoning text delta
            if (
              data.type === "response.reasoning_text.delta" ||
              currentEvent === "response.reasoning_text.delta"
            ) {
              const delta = data.delta as string | undefined;
              if (delta) {
                yield { type: "reasoning_delta", text: delta };
              }
            }

            // Output text delta
            if (
              data.type === "response.output_text.delta" ||
              currentEvent === "response.output_text.delta"
            ) {
              const delta = data.delta as string | undefined;
              if (delta) {
                yield { type: "text_delta", text: delta };
              }
            }

            // Tool call start
            if (
              data.type === "response.output_item.added" ||
              currentEvent === "response.output_item.added"
            ) {
              const item = data.item as
                | {
                    id?: string;
                    type?: string;
                    call_id?: string;
                    name?: string;
                  }
                | undefined;
              if (item?.type === "function_call") {
                hasToolCalls = true;
                const callId = item.call_id || item.id || `call_${Date.now()}`;
                const name = item.name || "";
                const itemId = item.id || callId;
                functionCalls.set(itemId, { id: callId, name, args: "" });
                if (name) {
                  yield { type: "tool_call_start", id: callId, name };
                }
              }
            }

            // Tool call arguments delta
            if (
              data.type === "response.function_call_arguments.delta" ||
              currentEvent === "response.function_call_arguments.delta"
            ) {
              const itemId = (data.item_id as string) || "";
              const delta = (data.delta as string) || "";
              const fc = functionCalls.get(itemId);
              if (fc && delta) {
                fc.args += delta;
                yield { type: "tool_call_delta", id: fc.id, cumulativeInputJson: fc.args };
              }
            }

            // Tool call arguments done
            if (
              data.type === "response.function_call_arguments.done" ||
              currentEvent === "response.function_call_arguments.done"
            ) {
              const itemId = (data.item_id as string) || "";
              const args = data.arguments as string | undefined;
              const fc = functionCalls.get(itemId);
              if (fc && args !== undefined) {
                fc.args = args;
              }
            }

            // Tool call end
            if (
              data.type === "response.output_item.done" ||
              currentEvent === "response.output_item.done"
            ) {
              const item = data.item as
                | {
                    id?: string;
                    type?: string;
                    call_id?: string;
                    name?: string;
                    arguments?: string;
                  }
                | undefined;
              if (item?.type === "function_call") {
                const callId = item.call_id || item.id || "";
                const name = item.name || "";
                const argsStr = item.arguments ?? functionCalls.get(item.id || "")?.args ?? "{}";
                const parsedInput = parseToolCallJson(argsStr);
                yield { type: "tool_call_end", id: callId, name, input: parsedInput };
              }
            }

            // Response completed
            if (
              data.type === "response.completed" ||
              currentEvent === "response.completed"
            ) {
              const resp = data.response as
                | {
                    usage?: {
                      input_tokens?: number;
                      output_tokens?: number;
                      output_tokens_details?: { reasoning_tokens?: number };
                      input_tokens_details?: { cached_tokens?: number };
                    };
                  }
                | undefined;

              if (resp?.usage) {
                const inputTokens = resp.usage.input_tokens ?? 0;
                const outputTokens = resp.usage.output_tokens ?? 0;
                const reasoning = resp.usage.output_tokens_details?.reasoning_tokens;
                const cached = resp.usage.input_tokens_details?.cached_tokens ?? 0;
                yield {
                  type: "usage",
                  inputTokens,
                  outputTokens,
                  ...(reasoning !== undefined && reasoning > 0
                    ? { reasoningTokens: reasoning }
                    : {}),
                  ...(cached > 0 ? { cachedInputTokens: cached } : {}),
                };
              }

              yield {
                type: "turn_end",
                stopReason: hasToolCalls ? "tool_use" : "end_turn",
              };
            }
          }
        }
      }
    } catch (err) {
      yield { type: "error", message: getErrorMessage(err) };
    } finally {
      reader.releaseLock();
    }
  }
}

export function createResponsesStyleProvider(
  opts: ResponsesStyleProviderOptions
): ModelProvider {
  return new ResponsesStyleProvider(opts);
}
