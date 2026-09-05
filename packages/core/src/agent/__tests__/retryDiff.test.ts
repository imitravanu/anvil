import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AgentSession, type AgentEvent, type AgentOptions } from "../index.js";
import { FakeProvider } from "./fakeProvider.js";
import type { StreamEvent } from "../../providers/types.js";

let root: string;
beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "anvil-retrydiff-"));
});
afterAll(() => fs.rm(root, { recursive: true, force: true }));

function broker(): AgentOptions["permissionBroker"] {
  return { async requestPermission() { return true; } };
}

async function collect(gen: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

describe("popLastUserTurn (/retry)", () => {
  it("unwinds the last exchange including tool results, returning the request", async () => {
    const turn1: StreamEvent[] = [
      { type: "text_delta", text: "First answer." },
      { type: "turn_end", stopReason: "end_turn" },
    ];
    const turn2: StreamEvent[] = [
      { type: "tool_call_start", id: "r1", name: "read_file" },
      { type: "tool_call_end", id: "r1", name: "read_file", input: { path: "x.txt" } },
      { type: "turn_end", stopReason: "tool_use" },
    ];
    const turn2cont: StreamEvent[] = [
      { type: "text_delta", text: "Second answer." },
      { type: "turn_end", stopReason: "end_turn" },
    ];
    const provider = new FakeProvider([turn1, turn2, turn2cont]);
    const session = new AgentSession(provider, {
      systemPrompt: "test",
      model: "fake-model",
      maxTokens: 1024,
      projectRoot: root,
      permissionBroker: broker(),
    });

    await collect(session.send("first question"));
    await collect(session.send("second question"));
    expect(session.getHistory()).toHaveLength(6); // 2 user + 2 assistant + tool_result user

    const text = session.popLastUserTurn();
    expect(text).toBe("second question");
    // History unwound to just before the second request: first exchange intact.
    const history = session.getHistory();
    expect(history).toHaveLength(2);
    expect(history[0].content[0]).toEqual({ type: "text", text: "first question" });

    // And the popped turn can be re-sent.
    const provider2 = new FakeProvider([
      [{ type: "text_delta", text: "Fresh answer." }, { type: "turn_end", stopReason: "end_turn" }],
    ]);
    const session2 = new AgentSession(provider2, {
      systemPrompt: "test", model: "fake-model", maxTokens: 1024,
      projectRoot: root, permissionBroker: broker(),
    }, { metadata: { id: "r", title: "r", providerId: "anthropic", model: "fake-model", createdAt: "", updatedAt: "" }, history: [...history] });
    if (text === null) throw new Error("unreachable");
    await collect(session2.send(text));
    expect(session2.getHistory().at(-1)?.content[0]).toEqual({ type: "text", text: "Fresh answer." });
  });

  it("returns null when there is nothing to unwind", async () => {
    const provider = new FakeProvider([
      [{ type: "text_delta", text: "hi" }, { type: "turn_end", stopReason: "end_turn" }],
    ]);
    const session = new AgentSession(provider, {
      systemPrompt: "test", model: "fake-model", maxTokens: 1024,
      projectRoot: root, permissionBroker: broker(),
    });
    expect(session.popLastUserTurn()).toBeNull();
  });
});

describe("summarizeChanges (/diff)", () => {
  it("diffs session-touched files against their pre-session baseline", async () => {
    await fs.writeFile(path.join(root, "app.txt"), "line1\nline2\n");
    const writeTurn: StreamEvent[] = [
      { type: "tool_call_start", id: "w", name: "write_file" },
      { type: "tool_call_end", id: "w", name: "write_file", input: { path: "app.txt", content: "line1\nCHANGED\n" } },
      { type: "turn_end", stopReason: "tool_use" },
    ];
    const cont: StreamEvent[] = [
      { type: "text_delta", text: "ok" },
      { type: "turn_end", stopReason: "end_turn" },
    ];
    const provider = new FakeProvider([writeTurn, cont]);
    const session = new AgentSession(provider, {
      systemPrompt: "test", model: "fake-model", maxTokens: 1024,
      projectRoot: root, permissionBroker: broker(),
    });
    await collect(session.send("edit app.txt"));

    const changes = await session.summarizeChanges();
    const app = changes.find((c) => c.path === "app.txt");
    expect(app?.kind).toBe("modified");
    expect(app?.diff).toContain("-line2");
    expect(app?.diff).toContain("+CHANGED");
  });
});
