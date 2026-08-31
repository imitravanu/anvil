import { describe, expect, it } from "vitest";
import {
  mapGeminiFinishReason,
  translateGeminiChunkStream,
  type RawGeminiChunk,
} from "../gemini.js";
import type { StreamEvent } from "../types.js";

async function collect(gen: AsyncGenerator<StreamEvent>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

async function* of(items: RawGeminiChunk[]): AsyncGenerator<RawGeminiChunk> {
  yield* items;
}

describe("mapGeminiFinishReason", () => {
  it("maps known finish reasons", () => {
    expect(mapGeminiFinishReason("STOP")).toBe("end_turn");
    expect(mapGeminiFinishReason("MAX_TOKENS")).toBe("max_tokens");
    expect(mapGeminiFinishReason("SAFETY")).toBe("unknown");
  });
});

describe("translateGeminiChunkStream", () => {
  it("emits text deltas, usage, and turn_end for a plain text turn", async () => {
    const events = await collect(
      translateGeminiChunkStream(
        of([
          {
            candidates: [{ content: { parts: [{ text: "Hello" }] } }],
            usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 1 },
          },
          {
            candidates: [{ content: { parts: [{ text: " world" }] } }],
            usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 3 },
          },
          {
            candidates: [{ finishReason: "STOP" }],
            usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 3 },
          },
        ])
      )
    );
    expect(events).toEqual([
      { type: "text_delta", text: "Hello" },
      { type: "text_delta", text: " world" },
      { type: "usage", inputTokens: 8, outputTokens: 3 },
      { type: "turn_end", stopReason: "end_turn" },
    ]);
  });

  it("emits usage only when the counts change, not on every chunk", async () => {
    const events = await collect(
      translateGeminiChunkStream(
        of([
          {
            candidates: [{ content: { parts: [{ text: "Hi" }] } }],
            usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 1 },
          },
          {
            candidates: [{ content: { parts: [{ text: "!" }] } }],
            usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 1 }, // unchanged
          },
          {
            candidates: [{ finishReason: "STOP" }],
            usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2 },
          },
        ])
      )
    );
    expect(events).toEqual([
      { type: "text_delta", text: "Hi" },
      { type: "text_delta", text: "!" },
      { type: "usage", inputTokens: 10, outputTokens: 2 },
      { type: "turn_end", stopReason: "end_turn" },
    ]);
  });

  it("reports tool_use as the stop reason when the turn contained a function call", async () => {
    const events = await collect(
      translateGeminiChunkStream(
        of([
          {
            candidates: [
              {
                content: {
                  parts: [{ functionCall: { id: "fc1", name: "read_file", args: { path: "a" } } }],
                },
              },
            ],
          },
          { candidates: [{ finishReason: "STOP" }] },
        ])
      )
    );
    expect(events).toEqual([
      { type: "tool_call_start", id: "fc1", name: "read_file" },
      { type: "tool_call_end", id: "fc1", name: "read_file", input: { path: "a" } },
      { type: "turn_end", stopReason: "tool_use" },
    ]);
  });

  it("produces exactly one error event (no throw) when the stream fails", async () => {
    async function* failing(): AsyncGenerator<RawGeminiChunk> {
      yield { candidates: [{ content: { parts: [{ text: "partial" }] } }] };
      throw new Error("network gone");
    }
    const events = await collect(translateGeminiChunkStream(failing()));
    expect(events.filter((e) => e.type === "error")).toEqual([
      { type: "error", message: "network gone" },
    ]);
    expect(events[events.length - 1].type).toBe("error");
  });
});
