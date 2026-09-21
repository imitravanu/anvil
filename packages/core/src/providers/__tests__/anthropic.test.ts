import { describe, expect, it } from "vitest";
import {
  mapStopReason,
  toAnthropicMessages,
  translateAnthropicStream,
  type RawAnthropicStreamEvent,
} from "../anthropic.js";
import type { StreamEvent } from "../types.js";

async function collect(gen: AsyncGenerator<StreamEvent>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

async function* of(items: RawAnthropicStreamEvent[]): AsyncGenerator<RawAnthropicStreamEvent> {
  yield* items;
}

describe("mapStopReason", () => {
  it("maps known Anthropic stop reasons", () => {
    expect(mapStopReason("end_turn")).toBe("end_turn");
    expect(mapStopReason("stop_sequence")).toBe("end_turn");
    expect(mapStopReason("tool_use")).toBe("tool_use");
    expect(mapStopReason("max_tokens")).toBe("max_tokens");
  });

  it("maps unrecognized-but-legitimate reasons to unknown, not error", () => {
    expect(mapStopReason("pause_turn")).toBe("unknown");
    expect(mapStopReason("refusal")).toBe("unknown");
    expect(mapStopReason("some_future_reason")).toBe("unknown");
  });
});

describe("translateAnthropicStream", () => {
  it("emits text deltas, usage, and turn_end for a plain text turn", async () => {
    // usage fields are FLAT on message_delta (SDK RawMessageDeltaEvent.usage:
    // MessageDeltaUsage with cumulative input_tokens/output_tokens) — not
    // nested under delta, which only carries stop_reason/container/stop_details.
    const events = await collect(
      translateAnthropicStream(
        of([
          { type: "message_start", message: { usage: { input_tokens: 12 } } },
          { type: "content_block_start", index: 0, content_block: { type: "text" } },
          { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello" } },
          { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: " world" } },
          { type: "content_block_stop", index: 0 },
          { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { input_tokens: 12, output_tokens: 7 } },
          { type: "message_stop" },
        ])
      )
    );
    expect(events).toEqual([
      { type: "text_delta", text: "Hello" },
      { type: "text_delta", text: " world" },
      { type: "usage", inputTokens: 12, outputTokens: 7 },
      { type: "turn_end", stopReason: "end_turn" },
    ]);
  });

  it("buffers tool input deltas by block index and assembles the JSON input", async () => {
    const events = await collect(
      translateAnthropicStream(
        of([
          { type: "message_start", message: { usage: { input_tokens: 10 } } },
          { type: "content_block_start", index: 0, content_block: { type: "text" } },
          {
            type: "content_block_delta",
            index: 0,
            delta: { type: "text_delta", text: "Reading the file..." },
          },
          { type: "content_block_stop", index: 0 },
          {
            type: "content_block_start",
            index: 1,
            content_block: { type: "tool_use", id: "toolu_1", name: "read_file" },
          },
          {
            type: "content_block_delta",
            index: 1,
            delta: { type: "input_json_delta", partial_json: '{"path":' },
          },
          {
            type: "content_block_delta",
            index: 1,
            delta: { type: "input_json_delta", partial_json: ' "src/app.ts"}' },
          },
          { type: "content_block_stop", index: 1 },
          { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { input_tokens: 10, output_tokens: 20 } },
        ])
      )
    );
    expect(events).toEqual([
      { type: "text_delta", text: "Reading the file..." },
      { type: "tool_call_start", id: "toolu_1", name: "read_file" },
      { type: "tool_call_delta", id: "toolu_1", cumulativeInputJson: '{"path":' },
      { type: "tool_call_delta", id: "toolu_1", cumulativeInputJson: '{"path": "src/app.ts"}' },
      { type: "tool_call_end", id: "toolu_1", name: "read_file", input: { path: "src/app.ts" } },
      { type: "usage", inputTokens: 10, outputTokens: 20 },
      { type: "turn_end", stopReason: "tool_use" },
    ]);
  });

  it("routes parallel tool-call blocks independently by index", async () => {
    const events = await collect(
      translateAnthropicStream(
        of([
          {
            type: "content_block_start",
            index: 0,
            content_block: { type: "tool_use", id: "toolu_a", name: "read_file" },
          },
          {
            type: "content_block_start",
            index: 1,
            content_block: { type: "tool_use", id: "toolu_b", name: "list_dir" },
          },
          {
            type: "content_block_delta",
            index: 1,
            delta: { type: "input_json_delta", partial_json: '{"dir":"/tmp"}' },
          },
          {
            type: "content_block_delta",
            index: 0,
            delta: { type: "input_json_delta", partial_json: '{"path":"x"}' },
          },
          { type: "content_block_stop", index: 0 },
          { type: "content_block_stop", index: 1 },
        ])
      )
    );
    expect(events.filter((e) => e.type === "tool_call_end")).toEqual([
      { type: "tool_call_end", id: "toolu_a", name: "read_file", input: { path: "x" } },
      { type: "tool_call_end", id: "toolu_b", name: "list_dir", input: { dir: "/tmp" } },
    ]);
  });

  it("keeps malformed tool JSON as the __parseError sentinel instead of collapsing to {}", async () => {
    // 22.2 regression: this translator had its own `catch {}` returning {} while
    // streaming.ts already carried the sentinel, so on Anthropic an all-optional
    // tool ran on invented defaults and the model was never told its arguments
    // were malformed.
    const events = await collect(
      translateAnthropicStream(
        of([
          {
            type: "content_block_start",
            index: 0,
            content_block: { type: "tool_use", id: "toolu_bad", name: "read_file" },
          },
          {
            type: "content_block_delta",
            index: 0,
            delta: { type: "input_json_delta", partial_json: '{"path":' },
          },
          { type: "content_block_stop", index: 0 },
        ])
      )
    );
    expect(events.filter((e) => e.type === "tool_call_end")).toEqual([
      {
        type: "tool_call_end",
        id: "toolu_bad",
        name: "read_file",
        input: { __parseError: true, rawInput: '{"path":' },
      },
    ]);
  });

  it("skips id-less tool blocks entirely instead of emitting orphan starts", async () => {
    const events = await collect(
      translateAnthropicStream(
        of([
          {
            type: "content_block_start",
            index: 0,
            content_block: { type: "tool_use", name: "read_file" },
          },
          {
            type: "content_block_delta",
            index: 0,
            delta: { type: "input_json_delta", partial_json: '{"path":"x"}' },
          },
          { type: "content_block_stop", index: 0 },
        ])
      )
    );
    expect(events).toEqual([]);
  });

  it("produces exactly one error event (no throw) when the stream fails", async () => {    async function* failing(): AsyncGenerator<RawAnthropicStreamEvent> {
      yield { type: "message_start", message: { usage: { input_tokens: 1 } } };
      throw new Error("boom");
    }
    const events = await collect(translateAnthropicStream(failing()));
    // The event already emitted before the failure is preserved; the failure
    // itself must surface as exactly one terminal error event, not a throw.
    expect(events.filter((e) => e.type === "error")).toEqual([{ type: "error", message: "boom" }]);
    expect(events[events.length - 1].type).toBe("error");
  });

  it("prefers cumulative message_delta usage over the message_start snapshot (real SDK shape)", async () => {
    // RawMessageDeltaEvent.usage is cumulative: input_tokens arrives here too,
    // not only on message_start. A tool-use stream that has not yet seen its
    // message_start still reports a real input count.
    const events = await collect(
      translateAnthropicStream(
        of([
          {
            type: "content_block_start",
            index: 0,
            content_block: { type: "tool_use", id: "toolu_c", name: "read_file" },
          },
          {
            type: "content_block_delta",
            index: 0,
            delta: { type: "input_json_delta", partial_json: '{"path":"x"}' },
          },
          { type: "content_block_stop", index: 0 },
          { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { input_tokens: 33, output_tokens: 21 } },
        ])
      )
    );
    expect(events.filter((e) => e.type === "usage")).toEqual([
      { type: "usage", inputTokens: 33, outputTokens: 21 },
    ]);
  });

  it("still emits usage from delta.usage for legacy/fixed-snapshot payloads (tolerant decode)", async () => {
    const events = await collect(
      translateAnthropicStream(
        of([
          { type: "message_start", message: { usage: { input_tokens: 12 } } },
          { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hi" } },
          { type: "message_delta", delta: { stop_reason: "end_turn", usage: { output_tokens: 3 } } },
          { type: "message_stop" },
        ])
      )
    );
    expect(events.filter((e) => e.type === "usage")).toEqual([
      { type: "usage", inputTokens: 12, outputTokens: 3 },
    ]);
  });
});

describe("toAnthropicMessages", () => {
  it("maps text, tool_use, and tool_result blocks mechanically", () => {
    const messages = [
      {
        role: "assistant" as const,
        content: [
          { type: "text" as const, text: "Let me look." },
          {
            type: "tool_call" as const,
            call: { id: "t1", name: "read_file", input: { path: "a.ts" } },
          },
        ],
      },
      {
        role: "user" as const,
        content: [
          {
            type: "tool_result" as const,
            result: { toolCallId: "t1", content: "file contents" },
          },
        ],
      },
    ];
    expect(toAnthropicMessages(messages)).toEqual([
      {
        role: "assistant",
        content: [
          { type: "text", text: "Let me look." },
          { type: "tool_use", id: "t1", name: "read_file", input: { path: "a.ts" } },
        ],
      },
      {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "t1", content: "file contents" }],
      },
    ]);
  });

  it("parses string-encoded tool input into an object", () => {
    const messages = [
      {
        role: "assistant" as const,
        content: [
          { type: "tool_call" as const, call: { id: "t2", name: "run", input: '{"cmd":"ls"}' } },
        ],
      },
    ];
    expect(toAnthropicMessages(messages)[0].content).toEqual([
      { type: "tool_use", id: "t2", name: "run", input: { cmd: "ls" } },
    ]);
  });

  it("passes the real image MIME through (no png hardcode)", () => {
    for (const mediaType of ["image/png", "image/jpeg", "image/webp", "image/gif"]) {
      const messages = [
        {
          role: "user" as const,
          content: [{ type: "image" as const, mediaType, data: "QUJD" }],
        },
      ];
      expect(toAnthropicMessages(messages)[0].content).toEqual([
        { type: "image", source: { type: "base64", media_type: mediaType, data: "QUJD" } },
      ]);
    }
  });
});
