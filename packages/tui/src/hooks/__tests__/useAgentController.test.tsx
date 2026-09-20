import { describe, expect, it } from "vitest";
import type React from "react";
import { Text } from "ink";
import { render } from "ink-testing-library";
import { AgentSession, type StreamEvent } from "@anvil/core";
import { TRANSCRIPT_STATE_CAP } from "../../util/displayLimits.js";
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
    expect(retainOutput(null)).toBeNull();
    expect(retainOutput(undefined)).toBeUndefined();
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
    const app = render(<Harness session={session} api={api} />);
    await new Promise((r) => setTimeout(r, 30));

    await api.current!.send("hello");
    await new Promise((r) => setTimeout(r, 50));

    const messages = api.current!.messages;
    const userMsg = messages.find((m: DisplayMessage) => m.role === "user");
    expect(userMsg).toBeDefined();
    expect(userMsg!.text).toBe("hello");
    app.unmount();
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
    const app = render(<Harness session={session} api={api} />);
    await new Promise((r) => setTimeout(r, 30));

    await api.current!.send("test");
    await new Promise((r) => setTimeout(r, 50));

    const assistantMsg = api.current!.messages.find((m: DisplayMessage) => m.role === "assistant");
    expect(assistantMsg).toBeDefined();
    expect(assistantMsg!.text).toBe("Hello world");
    app.unmount();
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
    const app = render(<Harness session={session} api={api} />);
    await new Promise((r) => setTimeout(r, 30));

    await api.current!.send("test");
    await new Promise((r) => setTimeout(r, 50));

    // After turn completes, isBusy should be false
    expect(api.current!.isBusy).toBe(false);
    expect(api.current!.messages.length).toBeGreaterThan(0);
    app.unmount();
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
    const app = render(<Harness session={session} api={api} />);
    await new Promise((r) => setTimeout(r, 30));

    await api.current!.send("test");
    await new Promise((r) => setTimeout(r, 50));

    expect(api.current!.usage.inputTokens).toBe(100);
    expect(api.current!.usage.outputTokens).toBe(50);
    app.unmount();
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
    const app = render(<Harness session={session} api={api} />);
    await new Promise((r) => setTimeout(r, 30));

    await api.current!.send("read test.txt");
    await new Promise((r) => setTimeout(r, 100));

    // Verify assistant message exists and turn completed
    const assistantMsg = api.current!.messages.find((m: DisplayMessage) => m.role === "assistant");
    expect(assistantMsg).toBeDefined();
    expect(api.current!.isBusy).toBe(false);
    app.unmount();
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
    const app = render(<Harness session={session} api={api} />);
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
    app.unmount();
  });

  it("bounds system-notice growth at TRANSCRIPT_STATE_CAP", async () => {
    const provider = fakeProvider([]);
    const session = new AgentSession(provider as never, {
      systemPrompt: "test",
      model: "fake-model",
      maxTokens: 1024,
      projectRoot: "/tmp",
      permissionBroker: { async requestPermission() { return true; } },
    });

    const api: { current: ReturnType<typeof useAgentController> | null } = { current: null };
    const app = render(<Harness session={session} api={api} />);
    await new Promise((r) => setTimeout(r, 30));

    for (let i = 0; i < TRANSCRIPT_STATE_CAP + 50; i++) {
      api.current!.printSystemMessage(`notice ${i}`);
    }
    await new Promise((r) => setTimeout(r, 50));

    expect(api.current!.messages.length).toBeLessThanOrEqual(TRANSCRIPT_STATE_CAP);
    // Newest notices survive; oldest are evicted.
    expect(api.current!.messages.at(-1)!.text).toContain(`notice ${TRANSCRIPT_STATE_CAP + 49}`);
    app.unmount();
  });
});

describe("useAgentController - Phase 23.8 stream backpressure buffer", () => {
  it("immediately flushes text buffer before tool call event without dropped text", async () => {
    const provider = fakeProvider([
      [
        { type: "text_delta", text: "Planning execution: " },
        { type: "tool_call_start", id: "t1", name: "run_command" },
        { type: "tool_call_delta", id: "t1", cumulativeInputJson: '{"command":"ls"}' },
        { type: "tool_call_end", id: "t1", name: "run_command", input: { command: "ls" } },
        { type: "turn_end", stopReason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "Done with bash" },
        { type: "turn_end", stopReason: "end_turn" },
      ],
    ]);
    const session = new AgentSession(provider as unknown as ConstructorParameters<typeof AgentSession>[0], {
      systemPrompt: "test",
      model: "fake-model",
      maxTokens: 1024,
      projectRoot: "/tmp",
      permissionBroker: { async requestPermission() { return true; } },
    });

    const api: { current: ReturnType<typeof useAgentController> | null } = { current: null };
    const app = render(<Harness session={session} api={api} />);
    await new Promise((r) => setTimeout(r, 30));

    await api.current!.send("run test");
    await new Promise((r) => setTimeout(r, 50));

    const assistantMsg = api.current!.messages.find((m: DisplayMessage) => m.role === "assistant");
    expect(assistantMsg).toBeDefined();
    expect(assistantMsg!.text).toContain("Planning execution: ");
    expect(assistantMsg!.text).toContain("Done with bash");
    expect(assistantMsg!.toolCalls.length).toBe(1);
    expect(assistantMsg!.toolCalls[0].name).toBe("run_command");
    app.unmount();
  });

  it("buffers rapid high-throughput token deltas and flushes cleanly on turn completion", async () => {
    const deltas: StreamEvent[] = Array.from({ length: 50 }, (_, i) => ({
      type: "text_delta" as const,
      text: `tok${i} `,
    }));
    deltas.push({ type: "turn_end", stopReason: "end_turn" });

    const provider = fakeProvider([deltas]);
    const session = new AgentSession(provider as unknown as ConstructorParameters<typeof AgentSession>[0], {
      systemPrompt: "test",
      model: "fake-model",
      maxTokens: 1024,
      projectRoot: "/tmp",
      permissionBroker: { async requestPermission() { return true; } },
    });

    const api: { current: ReturnType<typeof useAgentController> | null } = { current: null };
    const app = render(<Harness session={session} api={api} />);
    await new Promise((r) => setTimeout(r, 30));

    await api.current!.send("stream fast");
    await new Promise((r) => setTimeout(r, 50));

    const assistantMsg = api.current!.messages.find((m: DisplayMessage) => m.role === "assistant");
    expect(assistantMsg).toBeDefined();
    expect(assistantMsg!.text).toBe(Array.from({ length: 50 }, (_, i) => `tok${i} `).join(""));
    expect(assistantMsg!.streaming).toBe(false);
    app.unmount();
  });
});

describe("useAgentController - S6 cancel-queue UX", () => {
  // A provider that waits on the abort signal, then ends cleanly so the
  // engine emits `cancelled` (the real session.cancel() path). Awaiting
  // forever would hang the test: `send()` only observes cancellation at
  // loop-top / stream boundaries, and a never-resolving stream has none.
  function hangingProvider() {
    let turnSignal: AbortSignal | null = null;
    return {
      id: "anthropic" as const,
      displayName: "fake",
      isConfigured: () => true,
      async *streamCompletion(req: { signal?: AbortSignal }): AsyncGenerator<StreamEvent> {
        turnSignal = req.signal ?? null;
        await new Promise<void>((resolve) => {
          if (turnSignal?.aborted) {
            resolve();
            return;
          }
          turnSignal?.addEventListener("abort", () => resolve(), { once: true });
        });
        return;
      },
    };
  }

  function makeSession(provider: unknown): AgentSession {
    return new AgentSession(provider as ConstructorParameters<typeof AgentSession>[0], {
      systemPrompt: "test",
      model: "fake-model",
      maxTokens: 1024,
      projectRoot: "/tmp",
      permissionBroker: { async requestPermission() { return true; } },
    });
  }

  it("holds (not drains) messages typed during a cancelled turn + announces", async () => {
    const session = makeSession(hangingProvider());
    const api: { current: ReturnType<typeof useAgentController> | null } = { current: null };
    const app = render(<Harness session={session} api={api} />);
    await new Promise((r) => setTimeout(r, 30));

    const first = api.current!.send("long task");
    await new Promise((r) => setTimeout(r, 30));
    // Typed while busy → queues (does not throw, does not start a turn).
    await api.current!.send("typed during turn");
    expect(api.current!.queued).toEqual(["typed during turn"]);
    // Cancel the in-flight turn; the queued message must NOT fire.
    api.current!.cancel();
    await first;
    await new Promise((r) => setTimeout(r, 50));

    expect(api.current!.queued).toEqual(["typed during turn"]);
    const notice = api.current!.messages.find(
      (m: DisplayMessage) => m.role === "system" && m.text.includes("held, not sent")
    );
    expect(notice).toBeDefined();
    expect(notice!.text).toContain("1 queued message held");
    app.unmount();
  });

  it("still drains the queue after a normally completed turn (no hold notice)", async () => {
    const provider = fakeProvider([
      [{ type: "text_delta", text: "first done" }, { type: "turn_end", stopReason: "end_turn" }],
      [{ type: "text_delta", text: "second done" }, { type: "turn_end", stopReason: "end_turn" }],
    ]);
    const session = makeSession(provider);
    const api: { current: ReturnType<typeof useAgentController> | null } = { current: null };
    const app = render(<Harness session={session} api={api} />);
    await new Promise((r) => setTimeout(r, 30));

    await api.current!.send("first");
    await new Promise((r) => setTimeout(r, 50));

    // No queued traffic and no cancellation → no hold notice anywhere.
    expect(api.current!.queued).toEqual([]);
    const notice = api.current!.messages.find(
      (m: DisplayMessage) => m.role === "system" && m.text.includes("held, not sent")
    );
    expect(notice).toBeUndefined();
    app.unmount();
  });
});

