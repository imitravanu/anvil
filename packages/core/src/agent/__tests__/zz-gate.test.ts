import { describe, expect, it } from "vitest";
import { FakeProvider } from "./fakeProvider.js";
import { AgentSession } from "../index.js";
import type { StreamEvent } from "../../providers/types.js";

describe("gate", () => {
  it("stalls", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const gatedTurn = async function* (): AsyncGenerator<StreamEvent> {
      yield { type: "text_delta", text: "working" };
      await gate;
      yield { type: "turn_end", stopReason: "end_turn" };
    };
    const provider = new FakeProvider([gatedTurn as any]);
    const session = new AgentSession(provider, {
      systemPrompt: "t", model: "fake-model", maxTokens: 1024, projectRoot: "/tmp",
      permissionBroker: { async requestPermission() { return true; } },
    });
    const p = session.send("hi");
    const e1 = await p.next();
    console.error("EVENT1:", e1.value?.type);
    const e2 = Promise.race([p.next(), new Promise((r) => setTimeout(() => r("TIMEOUT"), 300))]);
    console.error("EVENT2:", JSON.stringify(await e2 === "TIMEOUT" ? "TIMEOUT(stalled OK)" : await e2));
    release();
  });
});
