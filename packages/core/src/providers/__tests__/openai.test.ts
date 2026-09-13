import { describe, expect, it } from "vitest";
import {
  createOpenAIProvider,
  mapOpenAIFinishReason,
  toOpenAIMessages,
  translateChatCompletionsChunkStream,
  type RawOpenAIChunk,
} from "../openai.js";
import { createOpenRouterProvider } from "../openrouter.js";
import type { ConversationMessage, StreamEvent } from "../types.js";

async function collect(gen: AsyncGenerator<StreamEvent>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

async function* of(items: RawOpenAIChunk[]): AsyncGenerator<RawOpenAIChunk> {
  yield* items;
}

describe("mapOpenAIFinishReason", () => {
  it("maps known finish reasons", () => {
    expect(mapOpenAIFinishReason("stop")).toBe("end_turn");
    expect(mapOpenAIFinishReason("tool_calls")).toBe("tool_use");
    expect(mapOpenAIFinishReason("length")).toBe("max_tokens");
    expect(mapOpenAIFinishReason("content_filter")).toBe("unknown");
  });
});

describe("translateChatCompletionsChunkStream", () => {
  it("emits text deltas, usage, and turn_end for a plain text turn", async () => {
    const events = await collect(
      translateChatCompletionsChunkStream(
        of([
          { choices: [{ delta: { content: "Hi" }, finish_reason: null }] },
          { choices: [{ delta: { content: "!" }, finish_reason: null }] },
          { choices: [{ delta: {}, finish_reason: "stop" }] },
          { choices: [], usage: { prompt_tokens: 5, completion_tokens: 2 } },
        ])
      )
    );
    expect(events).toEqual([
      { type: "text_delta", text: "Hi" },
      { type: "text_delta", text: "!" },
      { type: "usage", inputTokens: 5, outputTokens: 2 },
      { type: "turn_end", stopReason: "end_turn" },
    ]);
  });

  it("buffers tool-call argument fragments by index and assembles the input", async () => {
    const events = await collect(
      translateChatCompletionsChunkStream(
        of([
          {
            choices: [
              { delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "read_file", arguments: "" } }] }, finish_reason: null },
            ],
          },
          {
            choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"pa' } }] }, finish_reason: null }],
          },
          {
            choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'th":"a.ts"}' } }] }, finish_reason: null }],
          },
          { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
          { choices: [], usage: { prompt_tokens: 9, completion_tokens: 14 } },
        ])
      )
    );
    expect(events).toEqual([
      { type: "tool_call_start", id: "call_1", name: "read_file" },
      { type: "tool_call_delta", id: "call_1", cumulativeInputJson: '{"pa' },
      { type: "tool_call_delta", id: "call_1", cumulativeInputJson: '{"path":"a.ts"}' },
      { type: "tool_call_end", id: "call_1", name: "read_file", input: { path: "a.ts" } },
      { type: "usage", inputTokens: 9, outputTokens: 14 },
      { type: "turn_end", stopReason: "tool_use" },
    ]);
  });

  it("finalizes buffered calls even when the finish_reason chunk never arrives", async () => {
    const events = await collect(
      translateChatCompletionsChunkStream(
        of([
          {
            choices: [
              { delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "f", arguments: "{}" } }] }, finish_reason: null },
            ],
          },
        ])
      )
    );
    expect(events).toEqual([
      { type: "tool_call_start", id: "c1", name: "f" },
      { type: "tool_call_delta", id: "c1", cumulativeInputJson: "{}" },
      { type: "tool_call_end", id: "c1", name: "f", input: {} },
      { type: "turn_end", stopReason: "unknown" },
    ]);
  });

  it("emits usage exactly once even when gateways repeat it", async () => {
    const events = await collect(
      translateChatCompletionsChunkStream(
        of([
          { choices: [{ delta: { content: "Hi" }, finish_reason: null }], usage: { prompt_tokens: 5, completion_tokens: 2 } },
          { choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 5, completion_tokens: 9 } },
        ])
      )
    );
    expect(events).toEqual([
      { type: "text_delta", text: "Hi" },
      { type: "usage", inputTokens: 5, outputTokens: 9 },
      { type: "turn_end", stopReason: "end_turn" },
    ]);
  });

  it("defers start until the name arrives and freezes the first id", async () => {
    const events = await collect(
      translateChatCompletionsChunkStream(
        of([
          { choices: [{ delta: { tool_calls: [{ index: 0, id: "real-id" }] }, finish_reason: null }] },
          { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "f", arguments: "{}" } }] }, finish_reason: null }] },
          { choices: [{ delta: { tool_calls: [{ index: 0, id: "other-id" }] }, finish_reason: null }] },
          { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
        ])
      )
    );
    expect(events).toEqual([
      { type: "tool_call_start", id: "real-id", name: "f" },
      { type: "tool_call_delta", id: "real-id", cumulativeInputJson: "{}" },
      { type: "tool_call_end", id: "real-id", name: "f", input: {} },
      { type: "turn_end", stopReason: "tool_use" },
    ]);
  });

  it("produces exactly one error event (no throw) when the stream fails", async () => {    async function* failing(): AsyncGenerator<RawOpenAIChunk> {
      yield { choices: [{ delta: { content: "partial" }, finish_reason: null }] };
      throw new Error("connection reset");
    }
    const events = await collect(translateChatCompletionsChunkStream(failing()));
    // Partial output before the failure is preserved; the failure itself must
    // surface as exactly one terminal error event, not a throw.
    expect(events.filter((e) => e.type === "error")).toEqual([
      { type: "error", message: "connection reset" },
    ]);
    expect(events[events.length - 1].type).toBe("error");
  });
});

describe("toOpenAIMessages", () => {
  it("maps assistant tool_calls and user tool results to the chat-completions shape", () => {
    const messages: ConversationMessage[] = [
      { role: "user", content: [{ type: "text", text: "list files" }] },
      {
        role: "assistant",
        content: [{ type: "tool_call", call: { id: "c1", name: "list_dir", input: { dir: "." } } }],
      },
      {
        role: "user",
        content: [{ type: "tool_result", result: { toolCallId: "c1", content: "a.ts\nb.ts" } }],
      },
    ];
    expect(toOpenAIMessages(messages)).toEqual([
      { role: "user", content: "list files" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          { id: "c1", type: "function", function: { name: "list_dir", arguments: '{"dir":"."}' } },
        ],
      },
      { role: "tool", tool_call_id: "c1", content: "a.ts\nb.ts" },
    ]);
  });

  it("prepends system prompt if provided", () => {
    const messages: ConversationMessage[] = [
      { role: "user", content: [{ type: "text", text: "hello" }] },
    ];
    expect(toOpenAIMessages(messages, "You are a helpful assistant.")).toEqual([
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "hello" },
    ]);
  });

  it("emits tool results before text in the same turn to satisfy OpenAI protocol", () => {
    const messages: ConversationMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "Note: please check files" },
          { type: "tool_result", result: { toolCallId: "call_1", content: "done" } },
        ],
      },
    ];
    expect(toOpenAIMessages(messages)).toEqual([
      { role: "tool", tool_call_id: "call_1", content: "done" },
      { role: "user", content: "Note: please check files" },
    ]);
  });
});

describe("provider factories", () => {
  it("openai and openrouter are unconfigured without keys and do not throw", () => {
    const openai = createOpenAIProvider(undefined);
    const openrouter = createOpenRouterProvider(undefined);
    expect(openai.isConfigured()).toBe(false);
    expect(openrouter.isConfigured()).toBe(false);
    expect(openai.id).toBe("openai");
    expect(openrouter.id).toBe("openrouter");
  });

  it("unconfigured adapters emit a single error event instead of throwing", async () => {
    const provider = createOpenAIProvider(undefined);
    const events = await collect(
      provider.streamCompletion({
        model: "gpt-5.1",
        systemPrompt: "",
        messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
        tools: [],
        maxTokens: 10,
      })
    );
    expect(events).toEqual([
      {
        type: "error",
        message: "OpenAI API key not configured.",
        code: "AUTH_FAILED",
        isRetryable: false,
      },
    ]);
  });
});
