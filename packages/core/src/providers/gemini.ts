import { GoogleGenAI } from "@google/genai";
import { CompletionRequest, ConversationMessage, ModelProvider, StreamEvent } from "./types.js";

/**
 * Minimal structural view of a Gemini generateContentStream chunk. Gemini's
 * function-calling shape is "whole call at once" — a part carries the complete
 * functionCall — so there is no incremental delta buffering here.
 */
export interface RawGeminiChunk {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
        functionCall?: { id?: string; name?: string; args?: unknown };
      }>;
    };
    finishReason?: string | null;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  } | null;
}

export function mapGeminiFinishReason(
  reason: string | null | undefined
): "end_turn" | "tool_use" | "max_tokens" | "unknown" {
  if (reason === "STOP") return "end_turn";
  if (reason === "MAX_TOKENS") return "max_tokens";
  return "unknown";
}

export async function* translateGeminiChunkStream(
  raw: AsyncIterable<RawGeminiChunk>
): AsyncGenerator<StreamEvent> {
  let callCounter = 0;
  let sawFunctionCall = false;
  let finishReason: string | null = null;

  try {
    for await (const chunk of raw) {
      const candidate = chunk.candidates?.[0];
      const parts = candidate?.content?.parts ?? [];
      for (const part of parts) {
        if (typeof part.text === "string") {
          if (part.text) yield { type: "text_delta", text: part.text };
        } else if (part.functionCall) {
          sawFunctionCall = true;
          const id = part.functionCall.id ?? `gemini_call_${++callCounter}`;
          const name = part.functionCall.name ?? "";
          yield { type: "tool_call_start", id, name };
          yield { type: "tool_call_end", id, name, input: part.functionCall.args ?? {} };
        }
      }
      if (chunk.usageMetadata) {
        yield {
          type: "usage",
          inputTokens: chunk.usageMetadata.promptTokenCount ?? 0,
          outputTokens: chunk.usageMetadata.candidatesTokenCount ?? 0,
        };
      }
      if (candidate?.finishReason) finishReason = candidate.finishReason;
    }
  } catch (err) {
    yield { type: "error", message: err instanceof Error ? err.message : String(err) };
    return;
  }

  // Gemini has no dedicated stop reason for function-call turns (it reports
  // STOP); if we saw a call this turn, report tool_use so the agent loop knows
  // to execute tools and continue.
  if (sawFunctionCall) {
    yield { type: "turn_end", stopReason: "tool_use" };
  } else if (finishReason) {
    yield { type: "turn_end", stopReason: mapGeminiFinishReason(finishReason) };
  } else {
    yield { type: "turn_end", stopReason: "unknown" };
  }
}

export function toGeminiContents(messages: ConversationMessage[]): Record<string, unknown>[] {
  // Gemini's functionResponse parts are keyed by tool name, but our
  // ToolResultInput only carries the toolCallId — recover the name from the
  // assistant tool_call that produced it.
  const callNames = new Map<string, string>();
  for (const m of messages) {
    for (const c of m.content) {
      if (c.type === "tool_call") callNames.set(c.call.id, c.call.name);
    }
  }

  const contents: Record<string, unknown>[] = [];
  for (const m of messages) {
    const parts: Record<string, unknown>[] = [];
    for (const c of m.content) {
      if (c.type === "text") {
        parts.push({ text: c.text });
      } else if (c.type === "tool_call") {
        parts.push({
          functionCall: {
            id: c.call.id,
            name: c.call.name,
            args:
              typeof c.call.input === "object" && c.call.input !== null ? c.call.input : {},
          },
        });
      } else {
        const name = callNames.get(c.result.toolCallId) ?? "unknown_tool";
        let response: unknown;
        try {
          response = JSON.parse(c.result.content);
        } catch {
          response = { output: c.result.content };
        }
        parts.push({ functionResponse: { id: c.result.toolCallId, name, response } });
      }
    }
    if (parts.length > 0) {
      contents.push({ role: m.role === "assistant" ? "model" : "user", parts });
    }
  }
  return contents;
}

export function createGeminiProvider(apiKey: string | undefined): ModelProvider {
  const client = apiKey ? new GoogleGenAI({ apiKey }) : null;

  return {
    id: "gemini",
    displayName: "Google Gemini",
    isConfigured: () => !!client,

    async *streamCompletion(request: CompletionRequest): AsyncGenerator<StreamEvent> {
      if (!client) {
        yield { type: "error", message: "Gemini API key not configured." };
        return;
      }

      try {
        const stream = await client.models.generateContentStream({
          model: request.model,
          contents: toGeminiContents(request.messages) as never,
          config: {
            ...(request.systemPrompt ? { systemInstruction: request.systemPrompt } : {}),
            maxOutputTokens: request.maxTokens,
            abortSignal: request.signal,
            ...(request.tools.length
              ? {
                  tools: [
                    {
                      functionDeclarations: request.tools.map((t) => ({
                        name: t.name,
                        description: t.description,
                        parameters: t.inputSchema as never,
                      })),
                    },
                  ],
                }
              : {}),
          } as never,
        });

        yield* translateGeminiChunkStream(
          stream as unknown as AsyncIterable<RawGeminiChunk>
        );
      } catch (err) {
        yield { type: "error", message: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}
