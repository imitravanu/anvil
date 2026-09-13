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

describe("App Component - 22.17 MCP Boot Notices", () => {
  it("surfaces MCP boot notices on startup in system messages", async () => {
    const provider = fakeProvider();
    const broker = new TuiPermissionBroker();
    const sessionOptions = {
      projectRoot: process.cwd(),
      systemPrompt: "test",
      maxTokens: 1000,
    };
    const session = new AgentSession(provider, {
      ...sessionOptions,
      model: "claude-sonnet-5",
      permissionBroker: broker,
    });

    const mcp = {
      list: () => [],
      notices: ["MCP (file): mcp.json is not valid JSON", "MCP connect failed: Connection refused"],
      reconnect: async () => ({ problems: [], connected: 0, tools: 0 }),
    };

    const providers = {
      anthropic: provider,
      openai: provider,
      gemini: provider,
      openrouter: provider,
      orcarouter: provider,
      groq: provider,
      github: provider,
      cerebras: provider,
      mistral: provider,
      ollama: provider,
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
