import OpenAI from "openai";
import {
  CompletionRequest,
  ConversationMessage,
  ModelProvider,
  ProviderId,
  StreamEvent,
  ToolDefinition,
} from "./types.js";

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
  // index -> partially-assembled tool call
  const calls = new Map<number, { id: string; name: string; args: string }>();
  let finishReason: string | null = null;

  function* finalizeBufferedCalls(): Generator<StreamEvent> {
    for (const [, entry] of [...calls.entries()].sort((a, b) => a[0] - b[0])) {
      let parsed: unknown = {};
      try {
        parsed = entry.args.trim() ? JSON.parse(entry.args) : {};
      } catch {
        parsed = {}; // tool executor reports validation errors back to the model
      }
      yield { type: "tool_call_end", id: entry.id, name: entry.name, input: parsed };
    }
    calls.clear();
  }

  try {
    for await (const chunk of raw) {
      const choice = chunk.choices?.[0];
      const delta = choice?.delta;

      if (delta?.content) {
        yield { type: "text_delta", text: delta.content };
      }

      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          let entry = calls.get(tc.index);
          if (!entry) {
            entry = { id: tc.id ?? `call_${tc.index}`, name: tc.function?.name ?? "", args: "" };
            calls.set(tc.index, entry);
            yield { type: "tool_call_start", id: entry.id, name: entry.name };
          } else {
            if (tc.id) entry.id = tc.id;
            if (tc.function?.name) entry.name = tc.function.name;
          }
          if (tc.function?.arguments) {
            entry.args += tc.function.arguments;
            yield { type: "tool_call_delta", id: entry.id, partialInputJson: entry.args };
          }
        }
      }

      if (chunk.usage) {
        yield {
          type: "usage",
          inputTokens: chunk.usage.prompt_tokens ?? 0,
          outputTokens: chunk.usage.completion_tokens ?? 0,
        };
      }

      if (choice?.finish_reason) {
        finishReason = choice.finish_reason;
        yield* finalizeBufferedCalls();
      }
    }
  } catch (err) {
    yield { type: "error", message: err instanceof Error ? err.message : String(err) };
    return;
  }

  if (finishReason) {
    yield { type: "turn_end", stopReason: mapOpenAIFinishReason(finishReason) };
  } else {
    yield* finalizeBufferedCalls();
    yield { type: "turn_end", stopReason: "unknown" };
  }
}

export function toOpenAIMessages(messages: ConversationMessage[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
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
      if (text) out.push({ role: "user", content: text });
      for (const c of m.content) {
        if (c.type === "tool_result") {
          out.push({
            role: "tool",
            tool_call_id: c.result.toolCallId,
            content: c.result.content,
          });
        }
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
}

/**
 * Factory shared by the OpenAI and OpenRouter adapters — same wire format,
 * different credentials/base URL/parameter quirks.
 */
export function createChatCompletionsStyleProvider(
  opts: ChatCompletionsStyleProviderOptions
): ModelProvider {
  const client = opts.apiKey
    ? new OpenAI({
        apiKey: opts.apiKey,
        ...(opts.baseURL ? { baseURL: opts.baseURL } : {}),
        ...(opts.defaultHeaders ? { defaultHeaders: opts.defaultHeaders } : {}),
      })
    : null;
  const maxTokensParam = opts.maxTokensParam ?? "max_tokens";

  return {
    id: opts.id,
    displayName: opts.displayName,
    isConfigured: () => !!client,

    async *streamCompletion(request: CompletionRequest): AsyncGenerator<StreamEvent> {
      if (!client) {
        yield { type: "error", message: `${opts.displayName} API key not configured.` };
        return;
      }

      try {
        const stream = await client.chat.completions.create(
          {
            model: request.model,
            messages: toOpenAIMessages(request.messages) as never,
            ...(request.tools.length ? { tools: toOpenAITools(request.tools) as never } : {}),
            [maxTokensParam]: request.maxTokens,
            stream: true,
            stream_options: { include_usage: true },
          } as never,
          { signal: request.signal }
        );

        yield* translateChatCompletionsChunkStream(
          stream as unknown as AsyncIterable<RawOpenAIChunk>
        );
      } catch (err) {
        yield { type: "error", message: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}

export function createOpenAIProvider(apiKey: string | undefined): ModelProvider {
  return createChatCompletionsStyleProvider({
    id: "openai",
    displayName: "OpenAI",
    apiKey,
    maxTokensParam: "max_completion_tokens",
  });
}
