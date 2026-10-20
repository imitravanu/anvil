import { describe, expect, it } from "vitest";
import {
  createAgentRouterProvider,
  AGENTROUTER_BASE_URL,
  agentrouterProviderOptions,
} from "../agentrouter.js";
import { getModelsForProvider } from "../registry.js";
import { resolveProviderSelection } from "../../config/index.js";

describe("agentrouter provider", () => {
  it("exposes the stable gateway base URL and options", () => {
    expect(AGENTROUTER_BASE_URL).toBe("https://agentrouter.org/v1");
    const opts = agentrouterProviderOptions("test-key");
    expect(opts.id).toBe("agentrouter");
    expect(opts.displayName).toBe("AgentRouter");
    expect(opts.baseURL).toBe("https://agentrouter.org/v1");
    expect(opts.defaultHeaders).toEqual({
      "User-Agent": "opencode/1.18.25",
    });
    expect(opts.maxTokensParam).toBe("max_tokens");
    expect(opts.supportsVision).toBe(false);
  });

  it("configures provider when key is supplied", () => {
    const configured = createAgentRouterProvider("sk-test");
    expect(configured.id).toBe("agentrouter");
    expect(configured.displayName).toBe("AgentRouter");
    expect(configured.isConfigured()).toBe(true);

    const unconfigured = createAgentRouterProvider(undefined);
    expect(unconfigured.isConfigured()).toBe(false);
  });

  it("registers AgentRouter models in MODEL_REGISTRY", () => {
    const models = getModelsForProvider("agentrouter");
    expect(models.length).toBeGreaterThanOrEqual(3);
    const ids = models.map((m) => m.id);
    expect(ids).toContain("gpt-6.1-sol");
    expect(ids).toContain("gpt-6-astra");
    expect(ids).toContain("deepseek-v4-flash");
  });

  it("resolves default model for agentrouter as gpt-6.1-sol when agentrouter is configured", () => {
    const sel = resolveProviderSelection({
      creds: { agentrouterApiKey: "sk-test" },
    });
    expect(sel).toEqual({
      providerId: "agentrouter",
      model: "gpt-6.1-sol",
    });
  });

  it("translates conversation messages and tools to responses format", async () => {
    const { toResponsesInput, toResponsesTools } = await import("../agentrouter.js");
    const input = toResponsesInput([
      { role: "user", content: [{ type: "text", text: "What is the weather?" }] },
      {
        role: "assistant",
        content: [
          { type: "text", text: "Checking..." },
          {
            type: "tool_call",
            call: { id: "call_123", name: "get_weather", input: { location: "Tokyo" } },
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            result: { toolCallId: "call_123", content: '{"temp": 18}' },
          },
        ],
      },
    ]);

    expect(input).toHaveLength(4);
    expect(input[0]).toEqual({ role: "user", content: "What is the weather?" });
    expect(input[1]).toEqual({ role: "assistant", content: [{ type: "output_text", text: "Checking..." }] });
    expect(input[2]).toEqual({
      type: "function_call",
      call_id: "call_123",
      name: "get_weather",
      arguments: '{"location":"Tokyo"}',
    });
    expect(input[3]).toEqual({
      type: "function_call_output",
      call_id: "call_123",
      output: '{"temp": 18}',
    });

    const tools = toResponsesTools([
      {
        name: "get_weather",
        description: "Get weather",
        inputSchema: { type: "object", properties: { location: { type: "string" } } },
        mutating: false,
      },
    ]);
    expect(tools).toEqual([
      {
        type: "function",
        name: "get_weather",
        description: "Get weather",
        parameters: { type: "object", properties: { location: { type: "string" } } },
      },
    ]);
  });
});
