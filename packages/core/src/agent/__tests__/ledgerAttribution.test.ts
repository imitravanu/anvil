import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AgentSession, type AgentEvent, type AgentOptions } from "../index.js";
import { FakeProvider } from "./fakeProvider.js";

let root: string;

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "anvil-ledger-attr-"));
  await fs.writeFile(path.join(root, "a.txt"), "alpha");
  await fs.writeFile(path.join(root, "b.txt"), "beta");
});
afterAll(() => fs.rm(root, { recursive: true, force: true }));

async function collect(gen: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

/**
 * C13 (AUDIT-2026-09-30): measured usage rides on the assistant TURN, so a batch
 * that calls several tools must attribute it ONCE, not once per tool. The UI
 * sums tokens per ledger entry, so the old stamp-every-tool_finished rule
 * multiplied a turn's usage by its tool count.
 */
describe("ledger token attribution (C13)", () => {
  it("counts one turn's measured usage once, however many tools it called", async () => {
    const provider = new FakeProvider([
      [
        { type: "text_delta", text: "reading both" },
        { type: "tool_call_end", id: "t1", name: "read_file", input: { path: "a.txt" } },
        { type: "tool_call_end", id: "t2", name: "read_file", input: { path: "b.txt" } },
        { type: "usage", inputTokens: 100, outputTokens: 20 },
        { type: "turn_end", stopReason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "done" },
        { type: "usage", inputTokens: 120, outputTokens: 5 },
        { type: "turn_end", stopReason: "end_turn" },
      ],
    ]);
    const session = new AgentSession(provider, {
      systemPrompt: "test",
      model: "fake-model",
      maxTokens: 1024,
      projectRoot: root,
      permissionBroker: { async requestPermission() { return true; } },
    } satisfies AgentOptions);

    await collect(session.send("read both"));

    const ledger = session.getRunLedger();
    // The batch really did call two tools...
    expect(ledger.filter((e) => e.eventType === "tool_finished")).toHaveLength(2);
    // ...but the turn's usage is stamped on exactly one entry, so summing the
    // per-entry tokens reproduces the measured total instead of doubling it.
    const withTokens = ledger.filter((e) => e.tokens);
    expect(withTokens).toHaveLength(1);
    expect(withTokens[0].tokens).toEqual({ in: 100, out: 20 });
  });
});
