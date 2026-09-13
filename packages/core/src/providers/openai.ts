import { getErrorMessage } from "../errors.js";
import OpenAI from "openai";
import {
  CompletionRequest,
  ConversationMessage,
  ModelProvider,
  ProviderId,
  StreamEvent,
  ToolDefinition,
} from "./types.js";
import { ToolCallAssembler } from "./streaming.js";
import { BaseProvider } from "./base.js";

export function mapOpenAIFinishReason(
  reason: string | null | undefined
): "end_turn" | "tool_use" | "max_tokens" | "unknown" {
  if (reason === "stop") return "end_turn";
  if (reason === "tool_calls" || reason === "function_call") return "tool_use";
  if (reason === "length") return "max_tokens";
  return "unknown";
}

/**
 * Minimal structural view of a chat.completions stream chunk. Real SDK chunks
 * (and OpenRouter's identical wire format) are supersets of this shape.
 */
export interface RawOpenAIChunk {
  choices?: Array<{
    delta?: {
      content?: string | null;
      tool_calls?: Array<{
        index: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
}

/**
 * Shared streaming translator for the OpenAI chat-completions wire format.
 * OpenRouter speaks the exact same format, so its adapter reuses this instead
 * of duplicating the parse logic. OpenAI has no explicit "tool call ended"
 * event — the end is implied by the finish_reason chunk — so buffered calls
 * are finalized there (or at end-of-stream if the finish chunk never came).
 */
export async function* translateChatCompletionsChunkStream(
  raw: AsyncIterable<RawOpenAIChunk>
): AsyncGenerator<StreamEvent> {
  // Call assembly (id-freeze, name-deferred start, cumulative deltas) lives
  // in the shared ToolCallAssembler — see providers/streaming.ts.
  const assembler = new ToolCallAssembler();
  let finishReason: string | null = null;
  // Usage can arrive on any chunk (gateways repeat it); the contract is
  // exactly one usage event per turn, so only the latest counts are kept.
  let usage: { inputTokens: number; outputTokens: number } | null = null;

  try {
    for await (const chunk of raw) {
      const choice = chunk.choices?.[0];
      const delta = choice?.delta;

      if (delta?.content) {
        yield { type: "text_delta", text: delta.content };
      }

      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          yield* assembler.push(tc.index, {
            id: tc.id,
            name: tc.function?.name,
            argsFragment: tc.function?.arguments,
          });
        }
      }

      if (chunk.usage) {
        usage = {
          inputTokens: chunk.usage.prompt_tokens ?? 0,
          outputTokens: chunk.usage.completion_tokens ?? 0,
        };
      }

      if (choice?.finish_reason) {
        finishReason = choice.finish_reason;
        yield* assembler.drain();
      }
    }
  } catch (err) {
    yield { type: "error", message: getErrorMessage(err) };
    return;
  }

  if (usage) {
    yield { type: "usage", ...usage };
  }
  if (finishReason) {
    yield { type: "turn_end", stopReason: mapOpenAIFinishReason(finishReason) };
  } else {
    yield* assembler.drain();
    yield { type: "turn_end", stopReason: "unknown" };
  }
}

export function toOpenAIMessages(
  messages: ConversationMessage[],
  systemPrompt?: string,
  options?: { supportsVision?: boolean }
): Record<string, unknown>[] {
  const supportsVision = options?.supportsVision ?? true;
  const out: Record<string, unknown>[] = [];
  if (systemPrompt && systemPrompt.trim()) {
    out.push({ role: "system", content: systemPrompt });
  }
  for (const m of messages) {
    const text = m.content
      .filter((c) => c.type === "text")
      .map((c) => (c as { text: string }).text)
      .join("");
    if (m.role === "assistant") {
      const calls = m.content.filter((c) => c.type === "tool_call");
      out.push({
        role: "assistant",
        content: text || null,
        ...(calls.length
          ? {
              tool_calls: calls.map((c) => {
                const call = (c as { call: { id: string; name: string; input: unknown } }).call;
                return {
                  id: call.id,
                  type: "function",
                  function: {
                    name: call.name,
                    arguments:
                      typeof call.input === "string" ? call.input : JSON.stringify(call.input ?? {}),
                  },
                };
              }),
            }
          : {}),
      });
    } else {
      // In the OpenAI API, any role: "tool" results responding to assistant tool_calls
      // must immediately follow the assistant message. Emit tool results first.
      for (const c of m.content) {
        if (c.type === "tool_result") {
          out.push({
            role: "tool",
            tool_call_id: c.result.toolCallId,
            content: c.result.content,
          });
        }
      }

      // Vision / user text: user turns with attachments or notes follow tool results
      // (never preceding them, which would trigger an OpenAI 400 Bad Request).
      const images = m.content.filter((c) => c.type === "image") as Array<{
        mediaType: string;
        data: string;
      }>;
      if (images.length > 0) {
        const parts: Record<string, unknown>[] = [];
        if (text) parts.push({ type: "text", text });
        if (supportsVision) {
          for (const img of images) {
            parts.push({ type: "image_url", image_url: { url: `data:${img.mediaType};base64,${img.data}` } });
          }
        } else {
          for (let i = 0; i < images.length; i++) {
            parts.push({ type: "text", text: "[Image omitted — this provider does not support vision]" });
          }
        }
        out.push({ role: "user", content: parts });
      } else if (text) {
        out.push({ role: "user", content: text });
      }
    }
  }
  return out;
}

function toOpenAITools(tools: ToolDefinition[]): Record<string, unknown>[] {
  return tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.inputSchema },
  }));
}

export interface ChatCompletionsStyleProviderOptions {
  id: ProviderId;
  displayName: string;
  apiKey: string | undefined;
  /** Set for OpenAI-compatible gateways (e.g. OpenRouter). */
  baseURL?: string;
  /**
   * OpenAI's newer models reject `max_tokens` and require
   * `max_completion_tokens`, while most OpenAI-compatible gateways only know
   * `max_tokens`. The parameter name is therefore per-provider.
   */
  maxTokensParam?: "max_tokens" | "max_completion_tokens";
  defaultHeaders?: Record<string, string>;
  supportsVision?: boolean;
}

export class ChatCompletionsStyleProvider extends BaseProvider {
  readonly id: ProviderId;
  readonly displayName: string;

  private readonly client: OpenAI | null;
  private readonly maxTokensParam: "max_tokens" | "max_completion_tokens";
  protected readonly supportsVision: boolean;

  constructor(opts: ChatCompletionsStyleProviderOptions) {
    super();
    this.id = opts.id;
    this.displayName = opts.displayName;
    this.maxTokensParam = opts.maxTokensParam ?? "max_tokens";
    this.supportsVision = opts.supportsVision ?? true;

    this.client = opts.apiKey
      ? new OpenAI({
          apiKey: opts.apiKey,
          ...(opts.baseURL ? { baseURL: opts.baseURL } : {}),
          ...(opts.defaultHeaders ? { defaultHeaders: opts.defaultHeaders } : {}),
        })
      : null;
  }

  isConfigured(): boolean {
    return !!this.client;
  }

  protected async doStream(request: CompletionRequest): Promise<AsyncGenerator<StreamEvent>> {
    if (!this.client) {
      throw new Error(`${this.displayName} client not initialized`);
    }

    const stream = await this.client.chat.completions.create(
      {
        model: request.model,
        messages: toOpenAIMessages(request.messages, request.systemPrompt, {
          supportsVision: this.supportsVision,
        }) as unknown as OpenAI.ChatCompletionMessageParam[],
        ...(request.tools.length
          ? { tools: toOpenAITools(request.tools) as unknown as OpenAI.ChatCompletionTool[] }
          : {}),
        [this.maxTokensParam]: request.maxTokens,
        stream: true,
        stream_options: { include_usage: true },
      },
      { signal: request.signal }
    );

    return translateChatCompletionsChunkStream(
      stream as unknown as AsyncIterable<RawOpenAIChunk>
    );
  }
}

export function createChatCompletionsStyleProvider(
  opts: ChatCompletionsStyleProviderOptions
): ModelProvider {
  return new ChatCompletionsStyleProvider(opts);
}

export function createOpenAIProvider(apiKey: string | undefined): ModelProvider {
  return new ChatCompletionsStyleProvider({
    id: "openai",
    displayName: "OpenAI",
    apiKey,
    maxTokensParam: "max_completion_tokens",
  });
}
