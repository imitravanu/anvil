import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { AgentSession, type AgentEvent } from "../index.js";
import { runSubAgentLive } from "../subagent.js";
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

  it("deletes the sub-session checkpoint file after handing the ring to the parent", async () => {
    const savedHome = process.env.ANVIL_HOME;
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "anvil-sub-home-"));
    process.env.ANVIL_HOME = home;
    try {
      const provider = new FakeProvider([
        [
          { type: "tool_call_start", id: "s1", name: "write_file" },
          {
            type: "tool_call_end",
            id: "s1",
            name: "write_file",
            input: { path: "sub.txt", content: "from sub" },
          },
          { type: "turn_end", stopReason: "tool_use" },
        ],
        [
          { type: "text_delta", text: "Wrote it." },
          { type: "turn_end", stopReason: "end_turn" },
        ],
      ] as ScriptEntry[]);
      const controller = new AbortController();
      const gen = runSubAgentLive({
        provider,
        model: "fake-model",
        projectRoot: root,
        permissionBroker: { async requestPermission() { return true; } },
        task: "write sub.txt",
        signal: controller.signal,
      });
      let step = await gen.next();
      while (!step.done) step = await gen.next();
      const run = step.value;
      expect(run.aborted).toBe(false);
      expect(run.checkpoints).toHaveLength(1);
      // No orphan checkpoint files linger for the drained sub-session.
      const dir = path.join(home, "checkpoints");
      const leftovers = existsSync(dir) ? await fs.readdir(dir) : [];
      expect(leftovers).toEqual([]);
    } finally {
      if (savedHome === undefined) delete process.env.ANVIL_HOME;
      else process.env.ANVIL_HOME = savedHome;
      await fs.rm(home, { recursive: true, force: true });
    }
  });
});
