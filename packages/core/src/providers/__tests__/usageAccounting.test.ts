import { describe, expect, it } from "vitest";
import {
  translateGeminiChunkStream,
  type RawGeminiChunk,
} from "../gemini.js";
import { translateChatCompletionsChunkStream, type RawOpenAIChunk } from "../openai.js";
import type { StreamEvent } from "../types.js";

/**
 * PHASE 38.2 — TOKEN ACCOUNTING TRUTH
 *
 * Probe K measured `gemini-3.6-flash` returning `candidatesTokenCount: 1`
 * alongside `thoughtsTokenCount: 327`. The adapter read the first and dropped
 * the second, so a trivial turn was recorded as 1 output token when 328 were
 * spent. Probe L measured the opposite asymmetry on the OpenAI wire format:
 * `completion_tokens` ALREADY includes `reasoning_tokens` (515 of 641), so
 * there it must be broken out, never added.
 *
 * These tests pin both directions, because the correct treatment is opposite
 * in the two adapters and a "harmonizing" future edit that adds reasoning
 * twice on the OpenAI path would over-report just as badly.
 */

async function collect(gen: AsyncGenerator<StreamEvent>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

async function* geminiOf(items: RawGeminiChunk[]): AsyncGenerator<RawGeminiChunk> {
  yield* items;
}

async function* openaiOf(items: RawOpenAIChunk[]): AsyncGenerator<RawOpenAIChunk> {
  yield* items;
}

function usageOf(events: StreamEvent[]): { inputTokens: number; outputTokens: number; reasoningTokens?: number; cachedInputTokens?: number } {
  const u = events.find((e) => e.type === "usage");
  if (!u || u.type !== "usage") throw new Error("no usage event emitted");
  return u;
}

describe("Gemini usage — reasoning is ADDED (measured: 327 outside the count)", () => {
  it("adds thoughtsTokenCount to the reported output total", async () => {
    const events = await collect(
      translateGeminiChunkStream(
        geminiOf([
          {
            candidates: [{ content: { parts: [{ text: "A" }] }, finishReason: "STOP" }],
            usageMetadata: { promptTokenCount: 60, candidatesTokenCount: 1, thoughtsTokenCount: 327 },
          },
        ])
      )
    );
    // The real receipt: 328 tokens were spent, not 1.
    expect(usageOf(events).outputTokens).toBe(328);
  });

  it("breaks reasoning out separately for display", async () => {
    const events = await collect(
      translateGeminiChunkStream(
        geminiOf([
          {
            candidates: [{ finishReason: "STOP" }],
            usageMetadata: { promptTokenCount: 60, candidatesTokenCount: 1, thoughtsTokenCount: 327 },
          },
        ])
      )
    );
    expect(usageOf(events).reasoningTokens).toBe(327);
  });

  it("omits reasoningTokens when the model reports none — absence is not zero", async () => {
    const events = await collect(
      translateGeminiChunkStream(
        geminiOf([
          {
            candidates: [{ finishReason: "STOP" }],
            usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 3 },
          },
        ])
      )
    );
    const u = usageOf(events);
    expect(u.outputTokens).toBe(3);
    expect(u.reasoningTokens).toBeUndefined();
  });

  it("treats an explicit zero as zero, not as a missing field", async () => {
    const events = await collect(
      translateGeminiChunkStream(
        geminiOf([
          {
            candidates: [{ finishReason: "STOP" }],
            usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 3, thoughtsTokenCount: 0 },
          },
        ])
      )
    );
    const u = usageOf(events);
    expect(u.outputTokens).toBe(3);
    expect(u.reasoningTokens).toBeUndefined();
  });

  it("reports cached input as a breakdown of input, never an addition", async () => {
    const events = await collect(
      translateGeminiChunkStream(
        geminiOf([
          {
            candidates: [{ finishReason: "STOP" }],
            usageMetadata: {
              promptTokenCount: 1000,
              candidatesTokenCount: 5,
              cachedContentTokenCount: 800,
            },
          },
        ])
      )
    );
    const u = usageOf(events);
    expect(u.inputTokens).toBe(1000);
    expect(u.cachedInputTokens).toBe(800);
  });

  it("survives a chunk with no usageMetadata at all", async () => {
    const events = await collect(
      translateGeminiChunkStream(
        geminiOf([{ candidates: [{ content: { parts: [{ text: "hi" }] }, finishReason: "STOP" }] }])
      )
    );
    expect(events.some((e) => e.type === "usage")).toBe(false);
  });
});

describe("OpenAI usage — reasoning is a BREAKDOWN, not an addition", () => {
  it("does not double-count reasoning already inside completion_tokens", async () => {
    const events = await collect(
      translateChatCompletionsChunkStream(
        openaiOf([
          {
            choices: [{ delta: { content: "A" }, finish_reason: "stop" }],
            usage: {
              prompt_tokens: 55,
              completion_tokens: 641,
              completion_tokens_details: { reasoning_tokens: 515 },
            },
          },
        ])
      )
    );
    // The real receipt: 641 total, of which 515 reasoning. Adding would give
    // 1156 — a 80% over-report.
    const u = usageOf(events);
    expect(u.outputTokens).toBe(641);
    expect(u.reasoningTokens).toBe(515);
  });

  it("surfaces cached input tokens measured at 75% of the prompt", async () => {
    const events = await collect(
      translateChatCompletionsChunkStream(
        openaiOf([
          {
            choices: [{ delta: { content: "ok" }, finish_reason: "stop" }],
            usage: {
              prompt_tokens: 198,
              completion_tokens: 31,
              prompt_tokens_details: { cached_tokens: 149 },
            },
          },
        ])
      )
    );
    const u = usageOf(events);
    expect(u.inputTokens).toBe(198);
    expect(u.cachedInputTokens).toBe(149);
  });

  it("omits both breakdowns when the gateway sends neither", async () => {
    const events = await collect(
      translateChatCompletionsChunkStream(
        openaiOf([
          {
            choices: [{ delta: { content: "ok" }, finish_reason: "stop" }],
            usage: { prompt_tokens: 5, completion_tokens: 2 },
          },
        ])
      )
    );
    const u = usageOf(events);
    expect(u.reasoningTokens).toBeUndefined();
    expect(u.cachedInputTokens).toBeUndefined();
  });

  it("tolerates explicit nulls in the detail blocks", async () => {
    const events = await collect(
      translateChatCompletionsChunkStream(
        openaiOf([
          {
            choices: [{ delta: { content: "ok" }, finish_reason: "stop" }],
            usage: {
              prompt_tokens: 5,
              completion_tokens: 2,
              completion_tokens_details: { reasoning_tokens: null },
              prompt_tokens_details: { cached_tokens: null },
            },
          },
        ])
      )
    );
    const u = usageOf(events);
    expect(u.outputTokens).toBe(2);
    expect(u.reasoningTokens).toBeUndefined();
    expect(u.cachedInputTokens).toBeUndefined();
  });
});

describe("the two adapters disagree on purpose, and must stay that way", () => {
  it("sums Gemini reasoning but not OpenAI reasoning for the same numbers", async () => {
    // Identical token figures, opposite correct treatment. If a future change
    // harmonizes these, one adapter starts lying.
    const [gemini, openai] = await Promise.all([
      collect(
        translateGeminiChunkStream(
          geminiOf([
            {
              candidates: [{ finishReason: "STOP" }],
              usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 100, thoughtsTokenCount: 515 },
            },
          ])
        )
      ),
      collect(
        translateChatCompletionsChunkStream(
          openaiOf([
            {
              choices: [{ delta: { content: "x" }, finish_reason: "stop" }],
              usage: {
                prompt_tokens: 10,
                completion_tokens: 641,
                completion_tokens_details: { reasoning_tokens: 515 },
              },
            },
          ])
        )
      ),
    ]);
    // Gemini: 100 candidates + 515 reasoning = 615.
    expect(usageOf(gemini).outputTokens).toBe(615);
    // OpenAI: 641 already contains the 515.
    expect(usageOf(openai).outputTokens).toBe(641);
  });
});
