import { getErrorMessage } from "../errors.js";
import { GoogleGenAI } from "@google/genai";
import { CompletionRequest, ConversationMessage, ModelProvider, StreamEvent } from "./types.js";
import { BaseProvider } from "./base.js";

export interface RawGeminiChunk {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
        functionCall?: { id?: string; name?: string; args?: unknown };
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

let geminiCallCounter = 0;

export function geminiErrorMessage(err: unknown): string {
  const fallback = getErrorMessage(err);
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
    const deeper = unwrap(direct);
    return deeper ?? direct;
  }
  return fallback.length > 600 ? fallback.slice(0, 600) + "…" : fallback;
}

export async function* translateGeminiChunkStream(
  raw: AsyncIterable<RawGeminiChunk>
): AsyncGenerator<StreamEvent> {
  let sawFunctionCall = false;
  let finishReason: string | null = null;
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
      } else if (c.type === "image") {
        parts.push({ inlineData: { mimeType: c.mediaType, data: c.data } });
      } else if (c.type === "tool_call") {
        const signature = c.call.providerMetadata?.thoughtSignature;
        parts.push({
          functionCall: {
            id: c.call.id,
            name: c.call.name,
            args:
              typeof c.call.input === "object" && c.call.input !== null ? c.call.input : {},
          },
          ...(typeof signature === "string" ? { thoughtSignature: signature } : {}),
        });
      } else {
        const name = callNames.get(c.result.toolCallId);
        if (!name) {
          // Orphaned tool result — the originating tool_call was compacted away.
          // Skip rather than crash Gemini with "unknown_tool".
          continue;
        }
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

export class GeminiProvider extends BaseProvider {
  readonly id = "gemini" as const;
  readonly displayName = "Google Gemini";

  private readonly client: GoogleGenAI | null;

  constructor(apiKey: string | undefined) {
    super();
    this.client = apiKey ? new GoogleGenAI({ apiKey }) : null;
  }

  isConfigured(): boolean {
    return !!this.client;
  }

  protected async doStream(request: CompletionRequest): Promise<AsyncGenerator<StreamEvent>> {
    if (!this.client) {
      throw new Error("Gemini client not initialized");
    }

    // Pre-stream failures (bad key, 404 model, quota) bypass the in-stream
    // translator, so unwrap here — otherwise base.ts surfaces the raw nested
    // JSON blob. Abort rejections keep their signal; session.ts still maps
    // them to `cancelled` via its own aborted check.
    let stream;
    try {
      stream = await this.client.models.generateContentStream({
        model: request.model,
        contents: toGeminiContents(request.messages) as unknown as Parameters<
          typeof this.client.models.generateContentStream
        >[0]["contents"],
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
                      parametersJsonSchema: t.inputSchema,
                    })),
                  },
                ],
              }
            : {}),
        },
      });
    } catch (err) {
      throw new Error(geminiErrorMessage(err));
    }

    return translateGeminiChunkStream(
      stream as unknown as AsyncIterable<RawGeminiChunk>
    );
  }
}

export function createGeminiProvider(apiKey: string | undefined): ModelProvider {
  return new GeminiProvider(apiKey);
}