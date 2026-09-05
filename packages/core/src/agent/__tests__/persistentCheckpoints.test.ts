import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AgentSession, type AgentEvent, type AgentOptions, type RestoreData } from "../index.js";
import { FakeProvider } from "./fakeProvider.js";
import type { StreamEvent } from "../../providers/types.js";

// The checkpoint store resolves its dir lazily via anvilHome(), so setting
// ANVIL_HOME before the first write routes the test away from the real ~/.anvil.
let root: string;
let home: string;
let savedHome: string | undefined;

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "anvil-pcp-"));
  home = await fs.mkdtemp(path.join(os.tmpdir(), "anvil-pcp-home-"));
  savedHome = process.env.ANVIL_HOME;
  process.env.ANVIL_HOME = home;
});
afterAll(async () => {
  if (savedHome === undefined) delete process.env.ANVIL_HOME;
  else process.env.ANVIL_HOME = savedHome;
  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(home, { recursive: true, force: true });
});

function broker() {
  return { async requestPermission() { return true; } };
}

async function collect(gen: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

describe("persistent checkpoints", () => {
  it("restores a session's rewind ring after a restart", async () => {
    await fs.writeFile(path.join(root, "story.txt"), "original text");
    const writeTurn: StreamEvent[] = [
      { type: "tool_call_start", id: "w1", name: "write_file" },
      {
        type: "tool_call_end",
        id: "w1",
        name: "write_file",
        input: { path: "story.txt", content: "rewritten by the agent" },
      },
      { type: "turn_end", stopReason: "tool_use" },
    ];
    const finalTurn: StreamEvent[] = [
      { type: "text_delta", text: "done" },
      { type: "turn_end", stopReason: "end_turn" },
    ];

    // Session A: writes the file — a checkpoint is snapshotted and persisted.
    const providerA = new FakeProvider([writeTurn, finalTurn]);
    const sessionA = new AgentSession(providerA, {
      systemPrompt: "test",
      model: "fake-model",
      maxTokens: 1024,
      projectRoot: root,
      permissionBroker: broker(),
    });
    await collect(sessionA.send("rewrite story.txt"));
    expect(sessionA.getCheckpoints()).toHaveLength(1);
    const cpId = sessionA.getCheckpoints()[0].id;

    // The file on disk is the rewritten version.
    expect(await fs.readFile(path.join(root, "story.txt"), "utf8")).toBe("rewritten by the agent");

    // Session B: a "restart" — same session id restored from storage.
    const restore: RestoreData = {
      metadata: {
        id: sessionA.id,
        title: "restart",
        providerId: "anthropic",
        model: "fake-model",
        createdAt: sessionA.createdAt,
        updatedAt: sessionA.createdAt,
      },
      history: sessionA.getHistory() as [],
    };
    const providerB = new FakeProvider([
      [{ type: "text_delta", text: "rewound" }, { type: "turn_end", stopReason: "end_turn" }],
    ]);
    const sessionB = new AgentSession(
      providerB,
      {
        systemPrompt: "test",
        model: "fake-model",
        maxTokens: 1024,
        projectRoot: root,
        permissionBroker: broker(),
      },
      restore
    );

    // The ring survived the restart...
    expect(sessionB.getCheckpoints()).toHaveLength(1);
    expect(sessionB.getCheckpoints()[0].id).toBe(cpId);

    // ...and rewind actually restores the pre-agent file content.
    const result = await sessionB.rewind(cpId);
    expect(result.ok).toBe(true);
    expect(await fs.readFile(path.join(root, "story.txt"), "utf8")).toBe("original text");
  });
});
