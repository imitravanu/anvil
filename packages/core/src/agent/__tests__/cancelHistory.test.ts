import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AgentSession, type AgentEvent, type AgentOptions } from "../index.js";
import { FakeProvider, type ScriptEntry } from "./fakeProvider.js";
import type { StreamEvent } from "../../providers/types.js";

let root: string;

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "anvil-cancel-"));
});
afterAll(() => fs.rm(root, { recursive: true, force: true }));

function makeSession(script: ScriptEntry[], broker: AgentOptions["permissionBroker"]) {
  const provider = new FakeProvider(script);
  const session = new AgentSession(provider, {
    systemPrompt: "test",
    model: "fake-model",
    maxTokens: 1024,
    projectRoot: root,
    permissionBroker: broker,
  });
  return { provider, session };
}

/**
 * Regression: cancelling while a mutating tool's permission prompt is open
 * used to leave the assistant's tool_call in history with NO tool_result —
 * provider-replay poison (Anthropic rejects tool_use ids without matching
 * tool_result; Gemini rejects missing functionResponse). The turn must close
 * the batch with a synthetic cancelled result for every unanswered call.
 */
describe("cancellation mid-tool-batch repairs history", () => {
  it("fills unanswered tool calls with synthetic cancelled tool_results", async () => {
    // A broker that never answers — the user cancels instead of replying.
    const hangingBroker: AgentOptions["permissionBroker"] = {
      requestPermission: () => new Promise<boolean>(() => {}),
    };
    const { provider, session } = makeSession(
      [
        [
          { type: "text_delta", text: "Writing the file." },
          { type: "tool_call_start", id: "t1", name: "write_file" },
          {
            type: "tool_call_end",
            id: "t1",
            name: "write_file",
            input: { path: "out.txt", content: "x" },
          },
          { type: "turn_end", stopReason: "tool_use" },
        ],
        [
          { type: "text_delta", text: "Resumed fine." },
          { type: "turn_end", stopReason: "end_turn" },
        ],
      ],
      hangingBroker
    );

    const events: AgentEvent[] = [];
    // Cancel once the turn is parked on the never-answering permission prompt.
    const timer = setTimeout(() => session.cancel(), 50);
    for await (const e of session.send("do it")) events.push(e);
    clearTimeout(timer);
    expect(events.filter((e) => e.type === "cancelled")).toHaveLength(1);

    const history = session.getHistory();
    // user + assistant(tool_call) + user(tool_result) — batch closed.
    expect(history).toHaveLength(3);
    const results = history[2].content.filter((c) => c.type === "tool_result");
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      type: "tool_result",
      result: { toolCallId: "t1", isError: true },
    });

    // The next turn replays the repaired history and works normally.
    const second: AgentEvent[] = [];
    for await (const e of session.send("continue")) second.push(e);
    expect(second.map((e) => e.type)).toContain("turn_complete");
    const replayed = provider.calls[1].messages;
    // What the provider saw on the second call: repaired history + the new
    // "continue" user message — the repaired pair must be in the replay.
    // (getHistory() returns a copy, so re-snapshot after the second turn.)
    const after = session.getHistory();
    expect(replayed).toEqual(after.slice(0, 4));
  });
});
