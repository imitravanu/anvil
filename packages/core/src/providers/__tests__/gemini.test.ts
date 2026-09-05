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
    // Safety/system blocks are failures, never normal turns (P1).
    expect(mapGeminiFinishReason("SAFETY")).toBe("error");
    expect(mapGeminiFinishReason("RECITATION")).toBe("error");
    expect(mapGeminiFinishReason("SOMETHING_ELSE")).toBe("unknown");
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

  it("reports max_tokens over tool_use when the turn was cut off mid-call", async () => {
    const events = await collect(
      translateGeminiChunkStream(
        of([
          {
            candidates: [
              {
                content: {
                  parts: [{ functionCall: { id: "fc9", name: "read_file", args: {} } }],
                },
              },
            ],
          },
          { candidates: [{ finishReason: "MAX_TOKENS" }] },
        ])
      )
    );
    expect(events[events.length - 1]).toEqual({ type: "turn_end", stopReason: "max_tokens" });
  });

  it("reports safety blocks as errors, never as normal turns", async () => {
    for (const reason of ["SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT"]) {
      const events = await collect(
        translateGeminiChunkStream(of([{ candidates: [{ finishReason: reason }] }]))
      );
      expect(events[events.length - 1]).toEqual({ type: "turn_end", stopReason: "error" });
    }
    expect(mapGeminiFinishReason("SAFETY")).toBe("error");
    expect(mapGeminiFinishReason("STOP")).toBe("end_turn");
  });

  it("synthesizes call ids unique across turns", async () => {
    const one = await collect(
      translateGeminiChunkStream(
        of([{ candidates: [{ content: { parts: [{ functionCall: { name: "a", args: {} } }] } }] }])
      )
    );
    const two = await collect(
      translateGeminiChunkStream(
        of([{ candidates: [{ content: { parts: [{ functionCall: { name: "a", args: {} } }] } }] }])
      )
    );
    const id1 = (one[0] as { id: string }).id;
    const id2 = (two[0] as { id: string }).id;
    expect(id1).toMatch(/^gemini_call_\d+$/);
    expect(id2).toMatch(/^gemini_call_\d+$/);
    expect(id1).not.toBe(id2);
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
