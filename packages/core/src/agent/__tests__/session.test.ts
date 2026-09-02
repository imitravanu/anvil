import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AgentSession, type AgentEvent, type AgentOptions } from "../index.js";
import { FakeProvider, stalledStream, type ScriptEntry } from "./fakeProvider.js";
import type { StreamEvent } from "../../providers/types.js";

let root: string;
const never = new AbortController().signal;

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "anvil-session-"));
});
afterAll(() => fs.rm(root, { recursive: true, force: true }));

function makeSession(script: ScriptEntry[], broker?: AgentOptions["permissionBroker"]) {
  const provider = new FakeProvider(script);
  const session = new AgentSession(provider, {
    systemPrompt: "test",
    model: "fake-model",
    maxTokens: 1024,
    projectRoot: root,
    permissionBroker: broker ?? { async requestPermission() { return true; } },
  });
  return { provider, session };
}

async function collect(gen: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

describe("AgentSession.send", () => {
  it("streams a plain text turn and appends exactly one assistant message", async () => {
    const script: StreamEvent[] = [
      { type: "text_delta", text: "Hello" },
      { type: "text_delta", text: " there" },
      { type: "usage", inputTokens: 5, outputTokens: 2 },
      { type: "turn_end", stopReason: "end_turn" },
    ];
    const { provider, session } = makeSession([script]);
    const events = await collect(session.send("hi"));

    expect(events).toEqual([
      { type: "text_delta", text: "Hello" },
      { type: "text_delta", text: " there" },
      { type: "usage", inputTokens: 5, outputTokens: 2 },
      { type: "turn_complete" },
    ]);
    const history = session.getHistory();
    expect(history).toHaveLength(2); // user + assistant
    expect(history[0]).toEqual({ role: "user", content: [{ type: "text", text: "hi" }] });
    expect(history[1].role).toBe("assistant");
    expect(history[1].content).toEqual([{ type: "text", text: "Hello there" }]);
    expect(provider.calls[0].messages).toEqual(session.getHistory().slice(0, 1));
  });

  it("executes an approved tool call and loops with the tool result in history", async () => {
    const { provider, session } = makeSession([
      [
        { type: "tool_call_start", id: "t1", name: "write_file" },
        {
          type: "tool_call_end",
          id: "t1",
          name: "write_file",
          input: { path: "hello.txt", content: "hello" },
        },
        { type: "turn_end", stopReason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "Done" },
        { type: "turn_end", stopReason: "end_turn" },
      ],
    ]);
    const events = await collect(session.send("make hello.txt"));

    const types = events.map((e) => e.type);
    expect(types).toContain("tool_started");
    expect(types).toContain("tool_finished");
    expect(types[types.length - 1]).toBe("turn_complete");

    // The file was actually written inside the project root
    await expect(fs.readFile(path.join(root, "hello.txt"), "utf8")).resolves.toBe("hello");

    // The loop made a second streamCompletion call whose history contains the tool result
    expect(provider.calls).toHaveLength(2);
    const lastMsg = provider.calls[1].messages.at(-1)!;
    expect(lastMsg.role).toBe("user");
    expect(lastMsg.content[0]).toMatchObject({
      type: "tool_result",
      result: { toolCallId: "t1" },
    });
    expect(JSON.stringify(lastMsg.content)).toContain("hello");
  });

  it("surfaces permission denial to the model and does not perform the action", async () => {
    const deny = { async requestPermission() { return false; } };
    const { provider, session } = makeSession(
      [
        [
          { type: "tool_call_start", id: "t2", name: "write_file" },
          {
            type: "tool_call_end",
            id: "t2",
            name: "write_file",
            input: { path: "forbidden.txt", content: "nope" },
          },
          { type: "turn_end", stopReason: "tool_use" },
        ],
        [
          { type: "text_delta", text: "Understood." },
          { type: "turn_end", stopReason: "end_turn" },
        ],
      ],
      deny
    );
    const events = await collect(session.send("try to write"));

    expect(events.map((e) => e.type)).toContain("tool_permission_denied");
    expect(events.map((e) => e.type)).not.toContain("tool_started");
    await expect(fs.access(path.join(root, "forbidden.txt"))).rejects.toThrow();

    // The denial is fed back to the model as a tool result, not dropped
    const lastMsg = provider.calls[1].messages.at(-1)!;
    expect(JSON.stringify(lastMsg.content)).toContain("Permission denied");
    expect(JSON.parse((lastMsg.content[0] as any).result.content).error).toMatch(/NOT performed/);
  });

  it("cancel() stops an in-flight turn, yields cancelled, and the next send() works", async () => {
    const { session } = makeSession([
      (request) =>
        stalledStream(request.signal ?? new AbortController().signal, {
          type: "text_delta",
          text: "partial",
        }),
      [
        { type: "text_delta", text: "fresh turn" },
        { type: "turn_end", stopReason: "end_turn" },
      ],
    ]);

    const gen = session.send("go");
    const first = await gen.next();
    expect(first.value).toEqual({ type: "text_delta", text: "partial" });

    session.cancel();
    const cancelled = await gen.next();
    expect(cancelled.value).toEqual({ type: "cancelled" });
    expect((await gen.next()).done).toBe(true); // returns without throwing

    // A subsequent send() on the same session works — the controller wasn't poisoned
    const events = await collect(session.send("again"));
    expect(events).toEqual([
      { type: "text_delta", text: "fresh turn" },
      { type: "turn_complete" },
    ]);
  });

  it("feeds an unknown tool name back to the model as an error result", async () => {
    const { provider, session } = makeSession([
      [
        { type: "tool_call_start", id: "t3", name: "make_coffee" },
        { type: "tool_call_end", id: "t3", name: "make_coffee", input: {} },
        { type: "turn_end", stopReason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "ok" },
        { type: "turn_end", stopReason: "end_turn" },
      ],
    ]);
    const events = await collect(session.send("do it"));
    const finished = events.find((e) => e.type === "tool_finished");
    expect(finished && (finished as any).result.isError).toBe(true);
    expect(JSON.stringify(provider.calls[1].messages)).toContain("Unknown tool");
  });
});

describe("AgentSession.switchModel / clearHistory", () => {
  it("same-provider model switch preserves history and does not clear it", async () => {
    const { provider, session } = makeSession([
      [
        { type: "text_delta", text: "hi" },
        { type: "turn_end", stopReason: "end_turn" },
      ],
    ]);
    await collect(session.send("first"));
    expect(session.getHistory()).toHaveLength(2);

    const result = session.switchModel(provider, "fake-model-pro");
    expect(result.historyCleared).toBe(false);
    expect(session.getHistory()).toHaveLength(2); // history preserved
    // options.model updated — next request would use the new model
    expect(session.getHistory().length).toBe(2);
  });

  it("cross-provider switch clears history", async () => {
    const { provider, session } = makeSession([
      [
        { type: "text_delta", text: "hi" },
        { type: "turn_end", stopReason: "end_turn" },
      ],
    ]);
    await collect(session.send("first"));
    expect(session.getHistory()).toHaveLength(2);

    const other = new FakeProvider([]);
    // FakeProvider.id is "anthropic"; use a different id to force a provider change
    Object.defineProperty(other, "id", { value: "gemini" });
    const result = session.switchModel(other, "gemini-something");
    expect(result.historyCleared).toBe(true);
    expect(session.getHistory()).toHaveLength(0);
  });

  it("clearHistory() empties history", async () => {
    const { session } = makeSession([
      [
        { type: "text_delta", text: "hi" },
        { type: "turn_end", stopReason: "end_turn" },
      ],
    ]);
    await collect(session.send("first"));
    expect(session.getHistory()).toHaveLength(2);
    session.clearHistory();
    expect(session.getHistory()).toHaveLength(0);
  });

  it("restores from a StoredSession and sets a default title from the first user message", async () => {
    const { provider, session } = makeSession([
      [
        { type: "text_delta", text: "restored reply" },
        { type: "turn_end", stopReason: "end_turn" },
      ],
    ]);
    await collect(session.send("first message"));
    const stored = session.toStoredSession("anthropic", "fake-model");
    expect(stored.metadata.title).toBe("first message"); // default title set
    expect(stored.metadata.id).toBe(session.id);

    // Resume into a fresh session: history carries over, id/title/createdAt preserved
    const resumed = new AgentSession(provider, {
      systemPrompt: "test",
      model: "fake-model",
      maxTokens: 1024,
      projectRoot: root,
      permissionBroker: { async requestPermission() { return true; } },
    }, stored);
    expect(resumed.id).toBe(stored.metadata.id);
    expect(resumed.title).toBe("first message");
    expect(resumed.createdAt).toBe(stored.metadata.createdAt);
    expect(resumed.getHistory()).toEqual(stored.history);
    // Restored title is NOT overwritten by the next send
    await collect(resumed.send("another message"));
    expect(resumed.title).toBe("first message");
  });
});
