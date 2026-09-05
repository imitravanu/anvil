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
        // Gemini 3.x "thought signatures": opaque blobs returned on parts and
        // required to be echoed back in replayed history (esp. functionCall
        // parts) — see ai.google.dev/gemini-api/docs/thought-signatures
        thoughtSignature?: string;
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
): "end_turn" | "tool_use" | "max_tokens" | "error" | "unknown" {
  if (reason === "STOP") return "end_turn";
  if (reason === "MAX_TOKENS") return "max_tokens";
  // Safety/system blocks are failures, not normal turns — they must never
  // look like end_turn to the loop.
  if (
    reason === "SAFETY" ||
    reason === "RECITATION" ||
    reason === "BLOCKLIST" ||
    reason === "PROHIBITED_CONTENT" ||
    reason === "MALFORMED_FUNCTION_CALL"
  ) {
    return "error";
  }
  return "unknown";
}

// Module-level: synthetic ids must be unique across turns, not just within
// one. toGeminiContents rebuilds its id→name map over the FULL history, so a
// per-turn counter colliding (gemini_call_1 every turn) misattributes replays.
let geminiCallCounter = 0;

/**
 * Gemini error messages sometimes arrive as one or two layers of nested JSON
 * (e.g. a 429 quota error whose message is itself a JSON blob). Unwrap to the
 * human-readable message instead of dumping the whole object into the chat.
 */
export function geminiErrorMessage(err: unknown): string {
  const fallback = err instanceof Error ? err.message : String(err);
  const unwrap = (text: string): string | null => {
    try {
      const parsed = JSON.parse(text);
      const msg = parsed?.error?.message;
      return typeof msg === "string" ? msg : null;
    } catch {
      return null;
    }
  };
  const direct = unwrap(fallback);
  if (direct !== null) {
    const deeper = unwrap(direct); // the outer message may itself be a JSON blob
    return deeper ?? direct;
  }
  return fallback.length > 600 ? fallback.slice(0, 600) + "…" : fallback;
}

export async function* translateGeminiChunkStream(
  raw: AsyncIterable<RawGeminiChunk>
): AsyncGenerator<StreamEvent> {
  let sawFunctionCall = false;
  let finishReason: string | null = null;
  // Gemini attaches usageMetadata to many chunks with growing/cumulative
  // values. The contract says usage is emitted exactly once per turn, so we
  // buffer the latest counts and emit after the stream ends.
  let usage: { inputTokens: number; outputTokens: number } | null = null;

  try {
    for await (const chunk of raw) {
      const candidate = chunk.candidates?.[0];
      const parts = candidate?.content?.parts ?? [];
      for (const part of parts) {
        if (typeof part.text === "string") {
          if (part.text) yield { type: "text_delta", text: part.text };
        } else if (part.functionCall) {
          sawFunctionCall = true;
          const id = part.functionCall.id ?? `gemini_call_${++geminiCallCounter}`;
          const name = part.functionCall.name ?? "";
          yield { type: "tool_call_start", id, name };
          yield {
            type: "tool_call_end",
            id,
            name,
            input: part.functionCall.args ?? {},
            // Must round-trip through history or the next request 400s
            ...(part.thoughtSignature
              ? { providerMetadata: { thoughtSignature: part.thoughtSignature } }
              : {}),
          };
        }
      }
      if (chunk.usageMetadata) {
        usage = {
          inputTokens: chunk.usageMetadata.promptTokenCount ?? 0,
          outputTokens: chunk.usageMetadata.candidatesTokenCount ?? 0,
        };
      }
      if (candidate?.finishReason) finishReason = candidate.finishReason;
    }
  } catch (err) {
    yield { type: "error", message: geminiErrorMessage(err) };
    return;
  }

  if (usage) {
    yield { type: "usage", ...usage };
  }

  // Stop-reason precedence is honesty-critical: a cutoff or block must never
  // masquerade as a normal tool turn. MAX_TOKENS wins over calls (the turn was
  // cut); mapped errors (safety etc.) win over everything except transport
  // errors (already yielded above). Plain STOP + calls is the only tool_use.
  const mapped = mapGeminiFinishReason(finishReason);
  if (mapped === "error") {
    yield { type: "turn_end", stopReason: "error" };
  } else if (mapped === "max_tokens") {
    yield { type: "turn_end", stopReason: "max_tokens" };
  } else if (sawFunctionCall) {
    yield { type: "turn_end", stopReason: "tool_use" };
  } else if (finishReason) {
    yield { type: "turn_end", stopReason: mapped };
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
        const signature = c.call.providerMetadata?.thoughtSignature;
        parts.push({
          functionCall: {
            id: c.call.id,
            name: c.call.name,
            args:
              typeof c.call.input === "object" && c.call.input !== null ? c.call.input : {},
          },
          // Echo the thought signature back — Gemini 3.x rejects replayed
          // function-call history without it.
          ...(typeof signature === "string" ? { thoughtSignature: signature } : {}),
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
        yield { type: "error", message: geminiErrorMessage(err) };
      }
    },
  };
}
