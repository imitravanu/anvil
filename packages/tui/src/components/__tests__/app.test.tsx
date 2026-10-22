import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { cleanup, render as renderInk } from "ink-testing-library";
import { AgentSession, loadSession, type StreamEvent, type ModelProvider } from "@imitravanu/anvil-core";
import { App } from "../App.js";
import { TuiPermissionBroker } from "../../permission/TuiPermissionBroker.js";
import { frameText, renderThemed, tick } from "../../test-utils/testRender.js";

afterEach(() => cleanup());

describe("App — cancellation and session recovery", () => {
  it("restores the saved conversation after clear and includes it in the next provider turn", async () => {
    const state = bootApp();
    const turns: string[][] = [];
    state.providers.anthropic.streamCompletion = async function* (request) {
      turns.push(request.messages.flatMap(message => message.role === "user" ? message.content.flatMap(part => part.type === "text" ? [part.text] : []) : []));
      yield { type: "text_delta", text: "RECOVERY_ACK" };
      yield { type: "turn_end", stopReason: "end_turn" };
    };
    const app = renderThemed(<App {...state} providerId="anthropic" model="claude-sonnet-5" />);
    await tick();
    const submit = async (text: string) => {
      app.stdin.write(text);
      await vi.waitFor(() => expect(frameText(app.lastFrame)).toContain(text));
      app.stdin.write("\r");
    };
    await submit("remember this recovery checkpoint");
    await vi.waitFor(() => expect(loadSession(state.session.id)?.history.some(message => message.content.some(part => part.type === "text" && part.text === "RECOVERY_ACK"))).toBe(true));
    await vi.waitFor(() => expect(frameText(app.lastFrame)).toContain("Ready"));
    await submit("/clear");
    await vi.waitFor(() => expect(frameText(app.lastFrame)).toContain("Conversation cleared"));
    expect(loadSession(state.session.id)).not.toBeNull();
    await submit(`/session resume ${state.session.id}`);
    await vi.waitFor(() => expect(frameText(app.lastFrame)).toContain("Resumed"));
    expect(frameText(app.lastFrame)).toContain("RECOVERY_ACK");
    await submit("continue the restored conversation");
    await vi.waitFor(() => expect(turns).toHaveLength(2));
    expect(turns[1]).toContain("remember this recovery checkpoint");
    expect(turns[1]).toContain("continue the restored conversation");
    app.unmount();
  });

  it("cancels an active stream without exiting and holds queued work until explicit resume", async () => {
    const state = bootApp();
    let calls = 0;
    state.providers.anthropic.streamCompletion = async function* (request) {
      calls++;
      if (calls === 1) {
        yield { type: "text_delta", text: "STREAM_STARTED" };
        await new Promise<void>(resolve => {
          if (request.signal?.aborted) resolve();
          else request.signal?.addEventListener("abort", () => resolve(), { once: true });
        });
        return;
      }
      yield { type: "text_delta", text: "QUEUE_RESUMED" };
      yield { type: "turn_end", stopReason: "end_turn" };
    };
    const cancel = vi.spyOn(state.session, "cancel");
    const app = renderThemed(<App {...state} providerId="anthropic" model="claude-sonnet-5" />);
    await tick(); app.stdin.write("long task"); await tick(); app.stdin.write("\r");
    await vi.waitFor(() => expect(frameText(app.lastFrame)).toContain("STREAM_STARTED"));
    app.stdin.write("queued follow-up"); await tick(); app.stdin.write("\r");
    await vi.waitFor(() => expect(frameText(app.lastFrame)).toContain("1 message queued"));
    app.stdin.write("\x03");
    await vi.waitFor(() => expect(frameText(app.lastFrame)).toContain("1 message held"));
    expect(cancel).toHaveBeenCalledOnce();
    expect(calls).toBe(1);
    app.stdin.write("\x11");
    await vi.waitFor(() => expect(frameText(app.lastFrame)).toContain("queued follow-up"));
    app.stdin.write("r");
    await vi.waitFor(() => expect(frameText(app.lastFrame)).toContain("QUEUE_RESUMED"));
    expect(calls).toBe(2);
    app.unmount();
  });
});

function fakeProvider(): ModelProvider {
  return {
    id: "anthropic",
    displayName: "fake",
    isConfigured: () => true,
    streamCompletion: async function* (): AsyncGenerator<StreamEvent> {},
  };
}

/** Every provider id filled with one fake — `App` types `Record<ProviderId, …>`. */
function allProviders(provider: ModelProvider) {
  return {
    anthropic: provider,
    openai: provider,
    gemini: provider,
    openrouter: provider,
    orcarouter: provider,
    groq: provider,
    github: provider,
    cerebras: provider,
    mistral: provider,
    inception: provider,
    ollama: provider,
    qwencloud: provider,
    agentrouter: provider,
  };
}

/** Boot an App with a fake provider/session (no network, no TTY). */
function bootApp() {
  const provider = fakeProvider();
  const broker = new TuiPermissionBroker();
  const sessionOptions = { projectRoot: process.env.ANVIL_HOME ?? process.cwd(), systemPrompt: "test", maxTokens: 1000 };
  const session = new AgentSession(provider, {
    ...sessionOptions,
    model: "claude-sonnet-5",
    permissionBroker: broker,
  });
  return { session, broker, providers: allProviders(provider), sessionOptions };
}

describe("App Component - 22.17 MCP Boot Notices", () => {
  it("surfaces MCP boot notices on startup in system messages", async () => {
    const { session, broker, providers, sessionOptions } = bootApp();

    const mcp = {
      list: () => [],
      notices: ["MCP (file): mcp.json is not valid JSON", "MCP connect failed: Connection refused"],
      reconnect: async () => ({ problems: [], connected: 0, tools: 0 }),
    };

    const { lastFrame, unmount } = renderThemed(
      <App
        session={session}
        broker={broker}
        providers={providers}
        providerId="anthropic"
        model="claude-sonnet-5"
        sessionOptions={sessionOptions}
        mcp={mcp}
      />
    );

    await tick(100);
    const out = frameText(lastFrame);
    expect(out).toContain("MCP (file): mcp.json is not valid JSON");
    expect(out).toContain("MCP connect failed: Connection refused");
    unmount();
  });
});

describe("App — ? opens the help overlay end-to-end", () => {
  it("scrolls chat with terminal trackpad reports without changing the draft or approving an overlay", async () => {
    const state = bootApp();
    state.providers.anthropic.streamCompletion = async function* () {
      yield { type: "text_delta", text: Array.from({ length: 80 }, (_, index) => `wheel-row-${index}`).join("\n") };
      yield { type: "turn_end", stopReason: "end_turn" };
    };
    const send = vi.spyOn(state.session, "send");
    const app = renderThemed(<App {...state} providerId="anthropic" model="claude-sonnet-5" />);
    await tick(); app.stdin.write("task"); await tick(); app.stdin.write("\r");
    await vi.waitFor(() => expect(frameText(app.lastFrame)).toContain("wheel-row-79"));
    app.stdin.write("draft kept"); await tick();
    const firstVisible = () => Math.min(...Array.from(frameText(app.lastFrame).matchAll(/wheel-row-(\d+)/g), match => Number(match[1])));
    const initial = firstVisible();
    // Ink assembles split CSI reports, and processes coalesced bursts separately.
    app.stdin.write("\x1b[<64;20;"); app.stdin.write("10M");
    app.stdin.write("\x1b[<64;20;10M".repeat(6));
    await vi.waitFor(() => expect(firstVisible()).toBeLessThan(initial));
    expect(frameText(app.lastFrame)).toContain("draft kept");
    app.stdin.write("\x1b[<64;20;10M".repeat(80));
    await vi.waitFor(() => expect(firstVisible()).toBe(0));
    app.stdin.write("\x1b[<65;20;10M".repeat(3));
    await vi.waitFor(() => expect(firstVisible()).toBeGreaterThan(0));
    app.stdin.write("\x1b[<65;20;10M".repeat(40));
    await vi.waitFor(() => expect(frameText(app.lastFrame)).toContain("wheel-row-79"));
    let decided = false;
    const decision = state.broker.requestPermission("run_command", "Run command: npm test").then(value => { decided = true; return value; });
    await vi.waitFor(() => expect(frameText(app.lastFrame)).toContain("wants to run a command"));
    app.stdin.write("\x1b[<64;20;10M\x1b[<0;20;10M\x1b[<0;20;10m"); await tick();
    expect(decided).toBe(false);
    app.stdin.write("\x1b"); await expect(decision).resolves.toBe(false); await tick();
    app.stdin.write("\r");
    await vi.waitFor(() => expect(send).toHaveBeenLastCalledWith("draft kept", expect.anything()));
    app.unmount();
  });

  it("suspends hidden approval controls in a tiny terminal and restores the draft on resize", async () => {
    const state = bootApp();
    const app = renderInk(<App {...state} providerId="anthropic" model="claude-sonnet-5" />);
    let columns = 80; let rows = 24;
    Object.defineProperties(app.stdout, { columns: { get: () => columns }, rows: { get: () => rows } });
    await tick(); app.stdin.write("kept"); await tick();
    let decided = false;
    const decision = state.broker.requestPermission("run_command", "Run command: npm test").then(value => { decided = true; return value; });
    await vi.waitFor(() => expect(frameText(app.lastFrame)).toContain("wants to run a command"));
    columns = 30; rows = 8; app.stdout.emit("resize");
    await vi.waitFor(() => expect(frameText(app.lastFrame)).toContain("Resize to"));
    app.stdin.write("y"); await tick(); expect(decided).toBe(false);
    columns = 80; rows = 24; app.stdout.emit("resize");
    await vi.waitFor(() => expect(frameText(app.lastFrame)).toContain("wants to run a command"));
    app.stdin.write("\x1b"); await expect(decision).resolves.toBe(false); await tick();
    expect(frameText(app.lastFrame)).toContain("kept"); app.unmount();
  });
  it("keeps an unsent draft and cursor while an asynchronous permission owns input", async () => {
    const state = bootApp();
    const send = vi.spyOn(state.session, "send");
    const app = renderThemed(<App {...state} providerId="anthropic" model="claude-sonnet-5" />);
    await tick(); app.stdin.write("abc"); await tick(); app.stdin.write("\x1b[D"); await tick();
    const decision = state.broker.requestPermission("run_command", "Run command: npm test");
    await vi.waitFor(() => expect(frameText(app.lastFrame)).toContain("wants to run a command"));
    app.stdin.write("\x1b[200~ya\r\x1b[201~"); await tick();
    expect(frameText(app.lastFrame)).toContain("wants to run a command");
    app.stdin.write("\x1b"); await expect(decision).resolves.toBe(false); await tick();
    app.stdin.write("X"); await tick(); app.stdin.write("\r"); await tick();
    expect(send).toHaveBeenCalledWith("abXc", expect.anything()); app.unmount();
  });
  it("Ctrl+C cancels a turn while its permission overlay owns input", async () => {
    const state = bootApp();
    state.providers.anthropic.streamCompletion = async function* () {
      yield { type: "tool_call_end", id: "write", name: "write_file", input: { path: "audit-fixture.txt", content: "fixture" } };
      yield { type: "turn_end", stopReason: "tool_use" };
    };
    const cancel = vi.spyOn(state.session, "cancel");
    const app = renderThemed(<App {...state} providerId="anthropic" model="claude-sonnet-5" />);
    await tick();
    app.stdin.write("task"); await tick(); app.stdin.write("\r");
    await vi.waitFor(() => expect(frameText(app.lastFrame)).toContain("wants to write a file"), { timeout: 3000 });
    app.stdin.write("\x03");
    await tick();
    expect(cancel).toHaveBeenCalledOnce();
    expect(frameText(app.lastFrame)).not.toContain("wants to write a file");
    app.unmount();
  });
  it("shows help on a bare ? and restores the input bar on Esc", async () => {
    const { session, broker, providers, sessionOptions } = bootApp();
    const { lastFrame, unmount, stdin } = renderThemed(
      <App
        session={session}
        broker={broker}
        providers={providers}
        providerId="anthropic"
        model="claude-sonnet-5"
        sessionOptions={sessionOptions}
      />
    );
    await tick(100);

    // The prompt is empty and focused — this is the only state where `?` means
    // "open help" rather than typing a question mark.
    await vi.waitFor(() => expect(frameText(lastFrame)).toContain("Type a message"));
    stdin.write("?");
    await tick();
    const help = frameText(lastFrame);
    expect(help).toContain("Help (");
    expect(help).toContain("type to filter");
    expect(help).not.toContain("/rewind"); // windowed: keys first, commands below
    // Esc closes the overlay and hands the keyboard back to the prompt.
    stdin.write("\u001B");
    await tick();
    await vi.waitFor(() => expect(frameText(lastFrame)).toContain("Type a message"));
    unmount();
  });
});
