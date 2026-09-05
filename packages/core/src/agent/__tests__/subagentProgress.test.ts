import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AgentSession, type AgentEvent } from "../index.js";
import { FakeProvider, type ScriptEntry } from "./fakeProvider.js";
import type { StreamEvent } from "../../providers/types.js";

let root: string;
beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "anvil-sublive-"));
  await fs.writeFile(path.join(root, "note.txt"), "hello");
});
afterAll(() => fs.rm(root, { recursive: true, force: true }));

describe("live sub-agent progress", () => {
  it("relays subagent_progress while the delegation runs", async () => {
    const parentStart: StreamEvent[] = [
      { type: "tool_call_start", id: "d1", name: "delegate_task" },
      { type: "tool_call_end", id: "d1", name: "delegate_task", input: { task: "read the note" } },
      { type: "turn_end", stopReason: "tool_use" },
    ];
    // The sub-session consumes the next entries from the same fake provider.
    const subToolTurn: StreamEvent[] = [
      { type: "tool_call_start", id: "s1", name: "read_file" },
      { type: "tool_call_end", id: "s1", name: "read_file", input: { path: "note.txt" } },
      { type: "turn_end", stopReason: "tool_use" },
    ];
    const subFinal: StreamEvent[] = [
      { type: "text_delta", text: "The note says hello." },
      { type: "turn_end", stopReason: "end_turn" },
    ];
    const parentFinal: StreamEvent[] = [
      { type: "text_delta", text: "Done." },
      { type: "turn_end", stopReason: "end_turn" },
    ];
    const provider = new FakeProvider([parentStart, subToolTurn, subFinal, parentFinal] as ScriptEntry[]);
    const session = new AgentSession(provider, {
      systemPrompt: "test",
      model: "fake-model",
      maxTokens: 1024,
      projectRoot: root,
      permissionBroker: { async requestPermission() { return true; } },
    });

    const events: AgentEvent[] = [];
    for await (const e of session.send("delegate")) events.push(e);

    const progress = events.filter((e) => e.type === "subagent_progress");
    expect(progress.length).toBeGreaterThanOrEqual(1);
    const first = progress[0] as { tool: string; detail: string };
    expect(first.tool).toBe("read_file");
    expect(first.detail).toContain("note.txt");

    // The turn still completes with the finished card carrying usage + report.
    expect(events.map((e) => e.type)).toContain("subagent_finished");
    expect(events.map((e) => e.type)).toContain("turn_complete");
  });
});
