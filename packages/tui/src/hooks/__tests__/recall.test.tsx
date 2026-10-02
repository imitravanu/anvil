import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type React from "react";
import { Text } from "ink";
import { render } from "ink-testing-library";
import { AgentSession } from "@anvil/core";
import type { StreamEvent, CompletionRequest, ModelProvider, ProviderId } from "@anvil/core";
import { useAgentController } from "../useAgentController.js";
import { useSessionCommands } from "../useSessionCommands.js";
import { TuiPermissionBroker } from "../../permission/TuiPermissionBroker.js";

let home: string;

beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-recall-home-"));
  process.env.ANVIL_HOME = home;
});
afterAll(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

/** Gated turn 1 parks until the test releases it; turn 2 is a plain reply. */
function fakeProvider(): ModelProvider & { release: () => void; calls: () => number } {
  let call = 0;
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  return {
    release: () => release(),
    id: "anthropic",
    displayName: "fake",
    isConfigured: () => true,
    calls: () => call,
    async *streamCompletion(_request: CompletionRequest): AsyncGenerator<StreamEvent> {
      const n = call;
      call += 1;
      if (n === 0) {
        yield { type: "text_delta", text: "working" };
        await gate;
        yield { type: "turn_end", stopReason: "end_turn" };
      } else {
        yield { type: "text_delta", text: "answer" };
        yield { type: "turn_end", stopReason: "end_turn" };
      }
    },
  };
}

type Api = {
  handleSubmit: (text: string) => Promise<void>;
  sentHistory: () => string[];
  isBusy: () => boolean;
};

function Harness({ session, provider, api }: { session: AgentSession; provider: ModelProvider; api: React.MutableRefObject<Api | null> }) {
  const ctrl = useAgentController(session);
  const { handleSubmit } = useSessionCommands({
    session,
    providers: { [provider.id]: provider } as Record<ProviderId, ModelProvider>,
    activeProviderId: provider.id as ProviderId,
    currentModel: "fake-model",
    sessionOptions: { systemPrompt: "test", maxTokens: 1024, projectRoot: "/tmp" },
    broker: new TuiPermissionBroker(),
    isBusy: ctrl.isBusy,
    messages: ctrl.messages,
    printSystemMessage: ctrl.printSystemMessage,
    clearMessages: () => undefined,
    replaceMessages: () => undefined,
    applyTheme: () => undefined,
    setSession: () => undefined,
    setActiveProviderId: () => undefined,
    setCurrentModel: () => undefined,
    setIsModelPickerOpen: () => undefined,
    setIsSessionPickerOpen: () => undefined,
    setIsConnectOpen: () => undefined,
    setIsThemePickerOpen: () => undefined,
    setExpandTools: () => undefined,
    expandTools: false,
    send: ctrl.send,
    addPendingImage: () => undefined,
  });
  api.current = {
    handleSubmit,
    sentHistory: () => ctrl.sentHistory,
    isBusy: () => ctrl.isBusy,
  };
  return <Text>{`${ctrl.isBusy ? "busy" : "idle"}`}</Text>;
}

/**
 * F8 (AUDIT-2026-09-30): sent-history recall recorded a message TWICE when it
 * was queued mid-turn — once at submit (useSessionCommands.handleSubmit) and
 * again when the drain ran it (useAgentController.runTurn) — so submitting
 * A, B, C during a turn left recall reading A,B,C,B,C. Recording must happen at
 * exactly one layer (the layer that actually sends the turn).
 */
describe("sent-history recall records each message once (F8)", () => {
  it("does not duplicate messages queued while a turn is in flight", async () => {
    const provider = fakeProvider();
    const session = new AgentSession(provider, {
      systemPrompt: "test",
      model: "fake-model",
      maxTokens: 1024,
      projectRoot: "/tmp",
      permissionBroker: { async requestPermission() { return true; } },
    });
    const api: { current: Api | null } = { current: null };
    const app = render(<Harness session={session} provider={provider} api={api} />);
    await new Promise((r) => setTimeout(r, 30));

    const first = api.current!.handleSubmit("A");
    await new Promise((r) => setTimeout(r, 30)); // turn A parks on the gate
    expect(api.current!.isBusy()).toBe(true);

    void api.current!.handleSubmit("B"); // queued
    void api.current!.handleSubmit("C"); // queued
    await new Promise((r) => setTimeout(r, 30));

    provider.release();
    await first;
    await new Promise((r) => setTimeout(r, 60));

    // Exactly A, B, C — in that order, with no re-recorded tails.
    expect(api.current!.sentHistory()).toEqual(["A", "B", "C"]);
    app.unmount();
  });
});