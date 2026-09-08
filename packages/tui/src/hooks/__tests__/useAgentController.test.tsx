import { describe, expect, it } from "vitest";
import type React from "react";
import { Text } from "ink";
import { render } from "ink-testing-library";
import { AgentSession, type StreamEvent } from "@anvil/core";
import {
  useAgentController,
  retainOutput,
  OUTPUT_RETAIN_MAX,
  type DisplayMessage,
} from "../useAgentController.js";

// Minimal fake provider for testing
function fakeProvider(scripts: StreamEvent[][]) {
  let call = 0;
  return {
    id: "anthropic" as const,
    displayName: "fake",
    isConfigured: () => true,
    calls: () => call,
    async *streamCompletion(): AsyncGenerator<StreamEvent> {
      const turn = scripts[Math.min(call, scripts.length - 1)];
      call += 1;
      yield* turn;
    },
  };
}

// Harness exposing the controller for direct testing
function Harness({
  session,
  api,
}: {
  session: AgentSession;
  api: React.MutableRefObject<ReturnType<typeof useAgentController> | null>;
}) {
  const ctrl = useAgentController(session);
  api.current = ctrl;
  return <Text>{`${ctrl.isBusy ? "busy" : "idle"}`}</Text>;
}

describe("retainOutput", () => {
  it("returns small output unchanged", () => {
    const output = { result: "hello world" };
    expect(retainOutput(output)).toEqual(output);
  });

  it("truncates large output to OUTPUT_RETAIN_MAX", () => {
    const largeString = "x".repeat(OUTPUT_RETAIN_MAX + 1000);
    const output = { data: largeString };
    const result = retainOutput(output);
    // Result should be either a truncated object or a parsed JSON object
    expect(result).toBeDefined();
    const resultStr = JSON.stringify(result);
    expect(resultStr.length).toBeLessThanOrEqual(OUTPUT_RETAIN_MAX + 100); // Allow some overhead for the wrapper
  });

  it("truncates individual strings during serialization", () => {
    const hugeString = "a".repeat(5000);
    const output = { text: hugeString };
    const result = retainOutput(output) as { text: string };
    expect(result.text.length).toBeLessThan(5000);
    expect(result.text).toContain("[truncated]");
  });

  it("handles non-serializable output gracefully", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const result = retainOutput(circular) as { note: string };
    expect(result.note).toBe("[output not serializable for display]");
  });

  it("handles null and undefined", () => {
    // null serializes to "null" then parses back to null
    expect(retainOutput(null)).toBeNull();
    // undefined serializes to "undefined" (String fallback) then parses... but JSON.parse fails
    const undefinedResult = retainOutput(undefined);
    expect(undefinedResult).toBeDefined();
  });

  it("handles primitive values", () => {
    expect(retainOutput(42)).toBe(42);
    expect(retainOutput("hello")).toBe("hello");
    expect(retainOutput(true)).toBe(true);
  });
});

describe("useAgentController - message handling", () => {
  it("adds user message on send", async () => {
    const provider = fakeProvider([
      [{ type: "text_delta", text: "response" }, { type: "turn_end", stopReason: "end_turn" }],
    ]);
    const session = new AgentSession(provider as never, {
      systemPrompt: "test",
      model: "fake-model",
      maxTokens: 1024,
      projectRoot: "/tmp",
      permissionBroker: { async requestPermission() { return true; } },
    });

    const api: { current: ReturnType<typeof useAgentController> | null } = { current: null };
    render(<Harness session={session} api={api} />);
    await new Promise((r) => setTimeout(r, 30));

    await api.current!.send("hello");
    await new Promise((r) => setTimeout(r, 50));

    const messages = api.current!.messages;
    const userMsg = messages.find((m: DisplayMessage) => m.role === "user");
    expect(userMsg).toBeDefined();
    expect(userMsg!.text).toBe("hello");
  });

  it("accumulates text_delta events into assistant message", async () => {
    const provider = fakeProvider([
      [
        { type: "text_delta", text: "Hello " },
        { type: "text_delta", text: "world" },
        { type: "turn_end", stopReason: "end_turn" },
      ],
    ]);
    const session = new AgentSession(provider as never, {
      systemPrompt: "test",
      model: "fake-model",
      maxTokens: 1024,
      projectRoot: "/tmp",
      permissionBroker: { async requestPermission() { return true; } },
    });

    const api: { current: ReturnType<typeof useAgentController> | null } = { current: null };
    render(<Harness session={session} api={api} />);
    await new Promise((r) => setTimeout(r, 30));

    await api.current!.send("test");
    await new Promise((r) => setTimeout(r, 50));

    const assistantMsg = api.current!.messages.find((m: DisplayMessage) => m.role === "assistant");
    expect(assistantMsg).toBeDefined();
    expect(assistantMsg!.text).toBe("Hello world");
  });

  it("clears isBusy after turn completes", async () => {
    const provider = fakeProvider([
      [{ type: "text_delta", text: "done" }, { type: "turn_end", stopReason: "end_turn" }],
    ]);
    const session = new AgentSession(provider as never, {
      systemPrompt: "test",
      model: "fake-model",
      maxTokens: 1024,
      projectRoot: "/tmp",
      permissionBroker: { async requestPermission() { return true; } },
    });

    const api: { current: ReturnType<typeof useAgentController> | null } = { current: null };
    render(<Harness session={session} api={api} />);
    await new Promise((r) => setTimeout(r, 30));

    await api.current!.send("test");
    await new Promise((r) => setTimeout(r, 50));

    // After turn completes, isBusy should be false
    expect(api.current!.isBusy).toBe(false);
    expect(api.current!.messages.length).toBeGreaterThan(0);
  });
});

describe("useAgentController - usage tracking", () => {
  it("tracks usage totals from usage event", async () => {
    const provider = fakeProvider([
      [
        { type: "text_delta", text: "response" },
        { type: "usage", inputTokens: 100, outputTokens: 50 },
        { type: "turn_end", stopReason: "end_turn" },
      ],
    ]);
    const session = new AgentSession(provider as never, {
      systemPrompt: "test",
      model: "fake-model",
      maxTokens: 1024,
      projectRoot: "/tmp",
      permissionBroker: { async requestPermission() { return true; } },
    });

    const api: { current: ReturnType<typeof useAgentController> | null } = { current: null };
    render(<Harness session={session} api={api} />);
    await new Promise((r) => setTimeout(r, 30));

    await api.current!.send("test");
    await new Promise((r) => setTimeout(r, 50));

    expect(api.current!.usage.inputTokens).toBe(100);
    expect(api.current!.usage.outputTokens).toBe(50);
  });
});

describe("useAgentController - tool calls and events", () => {
  it("completes turn with tool_use stop reason", async () => {
    const provider = fakeProvider([
      [
        { type: "text_delta", text: "Let me read that file" },
        { type: "tool_call_start", id: "tool-1", name: "read_file" },
        { type: "tool_call_delta", id: "tool-1", cumulativeInputJson: '{"path":"test.txt"}' },
        { type: "tool_call_end", id: "tool-1", name: "read_file", input: { path: "test.txt" } },
        { type: "turn_end", stopReason: "tool_use" },
        { type: "text_delta", text: "Done" },
        { type: "turn_end", stopReason: "end_turn" },
      ],
    ]);
    const session = new AgentSession(provider as never, {
      systemPrompt: "test",
      model: "fake-model",
      maxTokens: 1024,
      projectRoot: "/tmp",
      permissionBroker: { async requestPermission() { return true; } },
    });

    const api: { current: ReturnType<typeof useAgentController> | null } = { current: null };
    render(<Harness session={session} api={api} />);
    await new Promise((r) => setTimeout(r, 30));

    await api.current!.send("read test.txt");
    await new Promise((r) => setTimeout(r, 100));

    // Verify assistant message exists and turn completed
    const assistantMsg = api.current!.messages.find((m: DisplayMessage) => m.role === "assistant");
    expect(assistantMsg).toBeDefined();
    expect(api.current!.isBusy).toBe(false);
  });

  it("handles gated turn completion", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const gatedTurn = async function* (): AsyncGenerator<StreamEvent> {
      yield { type: "text_delta", text: "working" };
      await gate;
      yield { type: "turn_end", stopReason: "end_turn" };
    };
    const provider = fakeProvider([gatedTurn as unknown as StreamEvent[]]);
    const session = new AgentSession(provider as never, {
      systemPrompt: "test",
      model: "fake-model",
      maxTokens: 1024,
      projectRoot: "/tmp",
      permissionBroker: { async requestPermission() { return true; } },
    });

    const api: { current: ReturnType<typeof useAgentController> | null } = { current: null };
    render(<Harness session={session} api={api} />);
    await new Promise((r) => setTimeout(r, 30));

    const sendPromise = api.current!.send("test");
    await new Promise((r) => setTimeout(r, 30));

    release();
    await sendPromise;
    await new Promise((r) => setTimeout(r, 30));

    expect(api.current!.isBusy).toBe(false);
    // After turn completes, assistant message should exist
    const assistantMsg = api.current!.messages.find((m: DisplayMessage) => m.role === "assistant");
    expect(assistantMsg).toBeDefined();
    expect(assistantMsg!.streaming).toBe(false);
  });
});
