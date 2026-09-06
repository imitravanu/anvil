import { describe, expect, it } from "vitest";
import type React from "react";
import { Text } from "ink";
import { render } from "ink-testing-library";
import { AgentSession } from "@anvil/core";
import type { StreamEvent } from "@anvil/core";
import { useAgentController } from "../useAgentController.js";

// Minimal fake provider inline (importing core test sources would break the
// tui tsconfig rootDir). Counts requests; scripts consumed per call.
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
      // Script entries may be plain event lists or zero-arg generator factories.
      yield* typeof turn === "function" ? (turn as () => AsyncGenerator<StreamEvent>)() : turn;
    },
  };
}

// Harness exposing the controller so the test can drive send() directly.
function Harness({
  session,
  api,
}: {
  session: AgentSession;
  api: React.MutableRefObject<ReturnType<typeof useAgentController> | null>;
}) {
  const ctrl = useAgentController(session);
  api.current = ctrl;
  return <Text>{`${ctrl.isBusy ? "busy" : "idle"} q=${ctrl.queued.length}`}</Text>;
}

describe("message queueing while busy", () => {
  it("queues a message typed mid-turn and drains it when the turn settles", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    // Turn 1 streams, then parks on the gate until the test releases it.
    const gatedTurn = async function* (): AsyncGenerator<StreamEvent> {
      yield { type: "text_delta", text: "working" };
      await gate;
      yield { type: "turn_end", stopReason: "end_turn" };
    };
    const plainTurn: StreamEvent[] = [
      { type: "text_delta", text: "second answer" },
      { type: "turn_end", stopReason: "end_turn" },
    ];
    const provider = fakeProvider([gatedTurn as unknown as StreamEvent[], plainTurn]);
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

    const first = api.current!.send("one");
    await new Promise((r) => setTimeout(r, 30)); // let turn 1 park on the gate
    expect(api.current!.isBusy).toBe(true);

    // Typed while busy: queued, not dropped, not sent yet.
    void api.current!.send("two");
    await new Promise((r) => setTimeout(r, 30));
    expect(api.current!.queued).toEqual(["two"]);
    expect(provider.calls()).toBe(1);

    release();
    await first; // drain runs turn 2 before send resolves
    await new Promise((r) => setTimeout(r, 50));

    expect(api.current!.queued).toEqual([]);
    expect(api.current!.isBusy).toBe(false);
    expect(provider.calls()).toBe(2);
    const texts = api.current!.messages.map((m) => m.text);
    expect(texts).toContain("one");
    expect(texts).toContain("two");
    expect(texts.join("|")).toContain("second answer");
    app.unmount();
  });
});
