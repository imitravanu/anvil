import { describe, expect, it, vi } from "vitest";
import { streamAssistantTurn, type StreamTurnInput, type TurnStreamResult } from "../turnStream.js";
import { TurnState } from "../turnState.js";
import { FakeProvider } from "./fakeProvider.js";
import type { AgentEvent } from "../types.js";
import type { StreamEvent } from "../../providers/types.js";

async function drain(gen: AsyncGenerator<AgentEvent, TurnStreamResult | null>) {
  const events: AgentEvent[] = [];
  let step = await gen.next();
  while (!step.done) {
    events.push(step.value);
    step = await gen.next();
  }
  return { events, result: step.value };
}

function makeInput(
  events: StreamEvent[],
  overrides: Partial<StreamTurnInput> = {}
): { input: StreamTurnInput; turn: TurnState; onUsage: ReturnType<typeof vi.fn> } {
  const turn = new TurnState(5);
  const onUsage = vi.fn();
  const input: StreamTurnInput = {
    provider: new FakeProvider([events]),
    model: "fake-model",
    systemPrompt: "system",
    messages: [],
    tools: [],
    maxTokens: 1024,
    controller: new AbortController(),
    turn,
    onUsage,
    ...overrides,
  };
  return { input, turn, onUsage };
}

describe("streamAssistantTurn", () => {
  it("accumulates text and assembles tool calls from deltas", async () => {
    const { input } = makeInput([
      { type: "text_delta", text: "Hel" },
      { type: "text_delta", text: "lo" },
      { type: "tool_call_start", id: "t1", name: "read_file" },
      { type: "tool_call_delta", id: "t1", cumulativeInputJson: '{"path":' },
      { type: "tool_call_delta", id: "t1", cumulativeInputJson: '{"path":"a.ts"}' },
      { type: "tool_call_end", id: "t1", name: "read_file", input: undefined },
      { type: "turn_end", stopReason: "tool_use" },
    ]);

    const { events, result } = await drain(streamAssistantTurn(input));

    expect(events.filter((e) => e.type === "text_delta")).toHaveLength(2);
    expect(result?.textParts).toEqual(["Hel", "lo"]);
    expect(result?.toolCalls).toEqual([{ id: "t1", name: "read_file", input: { path: "a.ts" } }]);
    expect(result?.stopReason).toBe("tool_use");
    expect(result?.rateLimitRetry).toBeNull();
    expect(result?.sawUsage).toBe(false);
  });

  it("uses an explicit tool_call_end input verbatim, skipping the buffer", async () => {
    const { input } = makeInput([
      { type: "tool_call_start", id: "t1", name: "write_file" },
      { type: "tool_call_delta", id: "t1", cumulativeInputJson: '{"ignored":true}' },
      {
        type: "tool_call_end",
        id: "t1",
        name: "write_file",
        input: { path: "b.ts", content: "x" },
      },
      { type: "turn_end", stopReason: "end_turn" },
    ]);

    const { result } = await drain(streamAssistantTurn(input));
    expect(result?.toolCalls[0].input).toEqual({ path: "b.ts", content: "x" });
  });

  it("records malformed accumulated JSON instead of throwing", async () => {
    const { input } = makeInput([
      { type: "tool_call_start", id: "t1", name: "read_file" },
      { type: "tool_call_delta", id: "t1", cumulativeInputJson: '{"path":' },
      { type: "tool_call_end", id: "t1", name: "read_file", input: undefined },
      { type: "turn_end", stopReason: "tool_use" },
    ]);

    const { result } = await drain(streamAssistantTurn(input));
    expect(result?.toolCalls[0].input).toEqual({ __parseError: true, rawInput: '{"path":' });
  });

  it("falls back to an empty object when no arguments were accumulated", async () => {
    const { input } = makeInput([
      { type: "tool_call_start", id: "t1", name: "no_args" },
      { type: "tool_call_end", id: "t1", name: "no_args", input: undefined },
      { type: "turn_end", stopReason: "tool_use" },
    ]);

    const { result } = await drain(streamAssistantTurn(input));
    expect(result?.toolCalls[0].input).toEqual({});
  });

  it("carries provider metadata through to the accumulated call", async () => {
    const { input } = makeInput([
      {
        type: "tool_call_end",
        id: "t1",
        name: "read_file",
        input: {},
        providerMetadata: { cache: "hit" },
      },
      { type: "turn_end", stopReason: "tool_use" },
    ]);

    const { result } = await drain(streamAssistantTurn(input));
    expect(result?.toolCalls[0].providerMetadata).toEqual({ cache: "hit" });
  });

  it("forwards usage and reports it via onUsage", async () => {
    const { input, onUsage } = makeInput([
      { type: "usage", inputTokens: 120, outputTokens: 40 },
      { type: "turn_end", stopReason: "end_turn" },
    ]);

    const { events, result } = await drain(streamAssistantTurn(input));

    expect(events).toContainEqual({ type: "usage", inputTokens: 120, outputTokens: 40 });
    expect(onUsage).toHaveBeenCalledWith({ inputTokens: 120, outputTokens: 40 });
    expect(result?.sawUsage).toBe(true);
  });

  it("surfaces a non-rate-limit error and returns null", async () => {
    const { input } = makeInput([
      { type: "error", message: "provider exploded" },
      { type: "turn_end", stopReason: "error" },
    ]);

    const { events, result } = await drain(streamAssistantTurn(input));
    expect(result).toBeNull();
    expect(events).toContainEqual({ type: "error", message: "provider exploded" });
  });

  it("converts the first rate-limit into a retry wait instead of an error", async () => {
    const { input, turn } = makeInput([
      { type: "error", message: "429 rate limit exceeded, retry in 3s" },
      { type: "turn_end", stopReason: "error" },
    ]);

    const { events, result } = await drain(streamAssistantTurn(input));

    expect(result?.rateLimitRetry).toBe(3);
    expect(turn.rateLimitRetried).toBe(true);
    expect(events.some((e) => e.type === "error")).toBe(false);
    expect(result?.stopReason).toBe("error");
  });

  it("surfaces a second rate-limit in the same turn", async () => {
    const alreadyRetried = new TurnState(5);
    alreadyRetried.rateLimitRetried = true;
    const { input } = makeInput(
      [
        { type: "error", message: "429 too many requests" },
        { type: "turn_end", stopReason: "error" },
      ],
      { turn: alreadyRetried }
    );

    const { events, result } = await drain(streamAssistantTurn(input));
    expect(result).toBeNull();
    expect(events).toContainEqual({ type: "error", message: "429 too many requests" });
  });
});
