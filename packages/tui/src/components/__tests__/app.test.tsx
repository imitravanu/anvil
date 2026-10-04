import { describe, expect, it } from "vitest";
import React from "react";
import { AgentSession, type StreamEvent, type ModelProvider } from "@anvil/core";
import { App } from "../App.js";
import { TuiPermissionBroker } from "../../permission/TuiPermissionBroker.js";
import { frameText, renderThemed, tick } from "../../test-utils/testRender.js";

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
  };
}

/** Boot an App with a fake provider/session (no network, no TTY). */
function bootApp() {
  const provider = fakeProvider();
  const broker = new TuiPermissionBroker();
  const sessionOptions = { projectRoot: process.cwd(), systemPrompt: "test", maxTokens: 1000 };
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
    expect(frameText(lastFrame)).toContain("Type a message");
    stdin.write("?");
    await tick();
    const help = frameText(lastFrame);
    expect(help).toContain("Help (");
    expect(help).toContain("type to filter");
    expect(help).not.toContain("/rewind"); // windowed: keys first, commands below
    // Esc closes the overlay and hands the keyboard back to the prompt.
    stdin.write("\u001B");
    await tick();
    expect(frameText(lastFrame)).toContain("Type a message");
    unmount();
  });
});
