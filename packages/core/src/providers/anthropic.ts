import Anthropic from "@anthropic-ai/sdk";
import { CompletionRequest, ConversationMessage, ModelProvider, StreamEvent } from "./types.js";
import { ensureTurnEnd } from "./streaming.js";

export type StopReason = "end_turn" | "tool_use" | "max_tokens" | "error" | "unknown";

export function mapStopReason(reason: string): StopReason {
  if (reason === "tool_use") return "tool_use";
  if (reason === "max_tokens") return "max_tokens";
  if (reason === "end_turn" || reason === "stop_sequence") return "end_turn";
  // A stop reason the provider legitimately returned that we don't recognize.
  // Deliberately NOT "error" — see the contract notes in the phase spec.
  return "unknown";
}

/**
 * Minimal structural view of the Anthropic streaming events this adapter
 * cares about. The SDK's own union types are supersets of this, so real
 * streams assign cleanly; keeping it structural is what lets unit tests feed
 * plain fixture objects instead of fabricating SDK classes.
 */
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
}

/**
 * The Anthropic SDK ties tool-input deltas to a content block by *index*, not
 * by an id, so routing goes through an index -> toolCallId map populated at
 * `content_block_start`. This translator is a pure function of its input
 * stream, which is what the unit tests exercise directly.
 */
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
        // A block without an id is unusable downstream (deltas/ends key by
        // id): skip it entirely rather than emitting a nameless orphan start.
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
          const rawJson = toolInputBuffers.get(toolId) ?? "";
          let parsed: unknown = {};
          try {
            parsed = rawJson.trim() ? JSON.parse(rawJson) : {};
          } catch {
            // Leave as empty object; the tool executor should treat missing
            // required fields as a validation error it reports back to the model.
          }
          yield { type: "tool_call_end", id: toolId, name: toolNames.get(toolId) ?? "", input: parsed };
        }
      } else if (event.type === "message_delta") {
        if (event.delta?.usage) {
          yield {
            type: "usage",
            inputTokens: usageIn,
            outputTokens: event.delta.usage.output_tokens ?? 0,
          };
        }
        if (event.delta?.stop_reason) {
          yield { type: "turn_end", stopReason: mapStopReason(event.delta.stop_reason) };
        }
      }
    }
  } catch (err) {
    yield { type: "error", message: err instanceof Error ? err.message : String(err) };
  }
}

export function toAnthropicMessages(messages: ConversationMessage[]): Anthropic.MessageParam[] {
  return messages.map((m) => {
    const content: Anthropic.ContentBlockParam[] = [];
    for (const c of m.content) {
      if (c.type === "text") {
        content.push({ type: "text", text: c.text });
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

export function createAnthropicProvider(apiKey: string | undefined): ModelProvider {
  const client = apiKey ? new Anthropic({ apiKey }) : null;

  return {
    id: "anthropic",
    displayName: "Anthropic",
    isConfigured: () => !!client,

    async *streamCompletion(request: CompletionRequest): AsyncGenerator<StreamEvent> {
      if (!client) {
        yield { type: "error", message: "Anthropic API key not configured." };
        return;
      }

      try {
        const stream = client.messages.stream(
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

        yield* ensureTurnEnd(
          translateAnthropicStream(
            stream as unknown as AsyncIterable<RawAnthropicStreamEvent>
          )
        );
      } catch (err) {
        yield { type: "error", message: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}
