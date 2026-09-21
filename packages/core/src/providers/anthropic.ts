import { getErrorMessage } from "../errors.js";
import Anthropic from "@anthropic-ai/sdk";
import { CompletionRequest, ConversationMessage, ModelProvider, ProviderId, StreamEvent } from "./types.js";
import { BaseProvider } from "./base.js";
import { parseToolCallJson } from "./streaming.js";

export type StopReason = "end_turn" | "tool_use" | "max_tokens" | "error" | "unknown";

export function mapStopReason(reason: string): StopReason {
  if (reason === "tool_use") return "tool_use";
  if (reason === "max_tokens") return "max_tokens";
  if (reason === "end_turn" || reason === "stop_sequence") return "end_turn";
  return "unknown";
}

export interface RawAnthropicStreamEvent {
  type: string;
  index?: number;
  message?: { usage?: { input_tokens?: number } };
  content_block?: { type: string; id?: string; name?: string };
  delta?: {
    type?: string;
    text?: string;
    partial_json?: string;
    stop_reason?: string | null;
    usage?: { output_tokens?: number };
  };
  // SDK RawMessageDeltaEvent carries usage FLAT on the event (MessageDeltaUsage
  // with cumulative input_tokens/output_tokens) — delta only carries
  // stop_reason/container/stop_details. Optional so the fixture shape with
  // delta.usage stays decodable too.
  usage?: { input_tokens?: number | null; output_tokens?: number | null };
}

export async function* translateAnthropicStream(
  raw: AsyncIterable<RawAnthropicStreamEvent>
): AsyncGenerator<StreamEvent> {
  const blockIndexToToolId = new Map<number, string>();
  const toolInputBuffers = new Map<string, string>();
  const toolNames = new Map<string, string>();
  let usageIn = 0;
  try {
    for await (const event of raw) {
      if (event.type === "message_start") {
        usageIn = event.message?.usage?.input_tokens ?? 0;
      } else if (event.type === "content_block_start" && event.content_block?.type === "tool_use") {
        const id = event.content_block.id;
        if (!id) continue;
        const index = event.index ?? -1;
        blockIndexToToolId.set(index, id);
        toolInputBuffers.set(id, "");
        toolNames.set(id, event.content_block.name ?? "");
        yield { type: "tool_call_start", id, name: event.content_block.name ?? "" };
      } else if (event.type === "content_block_delta") {
        if (event.delta?.type === "text_delta" && typeof event.delta.text === "string") {
          yield { type: "text_delta", text: event.delta.text };
        } else if (
          event.delta?.type === "input_json_delta" &&
          typeof event.delta.partial_json === "string"
        ) {
          const toolId = blockIndexToToolId.get(event.index ?? -1);
          if (toolId) {
            const next = (toolInputBuffers.get(toolId) ?? "") + event.delta.partial_json;
            toolInputBuffers.set(toolId, next);
            yield { type: "tool_call_delta", id: toolId, cumulativeInputJson: next };
          }
        }
      } else if (event.type === "content_block_stop") {
        const toolId = blockIndexToToolId.get(event.index ?? -1);
        if (toolId) {
          // Shared parser, not a local JSON.parse: a malformed buffer must keep
          // its `__parseError` provenance so the model is told its tool call was
          // malformed. A local `catch {}` here silently ran all-optional tools
          // on invented defaults (the exact 22.2 regression this replaced).
          const parsed = parseToolCallJson(toolInputBuffers.get(toolId) ?? "");
          yield { type: "tool_call_end", id: toolId, name: toolNames.get(toolId) ?? "", input: parsed };
        }
      } else if (event.type === "message_delta") {
        // Billing usage is flat on the event per the SDK type (MessageDeltaUsage,
        // cumulative); tolerate the legacy delta.usage shape for robustness.
        const flatUsage = event.usage;
        const nestedUsage = event.delta?.usage;
        if (flatUsage || nestedUsage) {
          yield {
            type: "usage",
            inputTokens: flatUsage?.input_tokens ?? usageIn,
            outputTokens: flatUsage?.output_tokens ?? nestedUsage?.output_tokens ?? 0,
          };
        }
        if (event.delta?.stop_reason) {
          yield { type: "turn_end", stopReason: mapStopReason(event.delta.stop_reason) };
        }
      }
    }
  } catch (err) {
    yield { type: "error", message: getErrorMessage(err) };
  }
}

export function toAnthropicMessages(messages: ConversationMessage[]): Anthropic.MessageParam[] {
  return messages.map((m) => {
    const content: Anthropic.ContentBlockParam[] = [];
    for (const c of m.content) {
      if (c.type === "text") {
        content.push({ type: "text", text: c.text });
      } else if (c.type === "image") {
        // /image only admits png/jpeg/webp/gif — exactly Anthropic's supported
        // set — so the real MIME passes through. (The old code hardcoded
        // "image/png", which mislabeled every jpeg/webp/gif and failed.)
        const mediaType =
          c.mediaType === "image/jpeg" ||
          c.mediaType === "image/png" ||
          c.mediaType === "image/gif" ||
          c.mediaType === "image/webp"
            ? c.mediaType
            : "image/png";
        content.push({
          type: "image",
          source: { type: "base64", media_type: mediaType, data: c.data },
        });
      } else if (c.type === "tool_call") {
        let input: unknown = c.call.input;
        if (typeof input === "string") {
          try {
            input = JSON.parse(input);
          } catch {
            input = {};
          }
        }
        content.push({
          type: "tool_use",
          id: c.call.id,
          name: c.call.name,
          input: input as Record<string, unknown>,
        });
      } else {
        content.push({
          type: "tool_result",
          tool_use_id: c.result.toolCallId,
          content: c.result.content,
          ...(c.result.isError ? { is_error: true } : {}),
        });
      }
    }
    return { role: m.role, content } as Anthropic.MessageParam;
  });
}

export class AnthropicProvider extends BaseProvider {
  readonly id: ProviderId = "anthropic";
  readonly displayName = "Anthropic";

  private readonly client: Anthropic | null;

  constructor(apiKey: string | undefined) {
    super();
    this.client = apiKey ? new Anthropic({ apiKey }) : null;
  }

  isConfigured(): boolean {
    return !!this.client;
  }

  protected doStream(request: CompletionRequest): AsyncGenerator<StreamEvent> {
    if (!this.client) {
      // This shouldn't happen because isConfigured is checked in base class,
      // but TypeScript doesn't know that.
      throw new Error("Anthropic client not initialized");
    }

    const stream = this.client.messages.stream(
      {
        model: request.model,
        max_tokens: request.maxTokens,
        ...(request.systemPrompt ? { system: request.systemPrompt } : {}),
        ...(request.tools.length
          ? {
              tools: request.tools.map((t) => ({
                name: t.name,
                description: t.description,
                input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
              })),
            }
          : {}),
        messages: toAnthropicMessages(request.messages),
      },
      { signal: request.signal }
    );

    return translateAnthropicStream(stream as AsyncIterable<RawAnthropicStreamEvent>);
  }
}

export function createAnthropicProvider(apiKey: string | undefined): ModelProvider {
  return new AnthropicProvider(apiKey);
}