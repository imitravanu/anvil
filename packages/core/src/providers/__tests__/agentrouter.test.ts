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
    expect(models.length).toBeGreaterThan(0);
    const ids = models.map((m) => m.id);
    expect(ids).toContain("deepseek-v4-flash");
    expect(ids).toContain("gpt-6-astra");
    expect(ids).toContain("gpt-6.1-sol");
  });

  it("resolves default model for agentrouter when agentrouter is configured", () => {
    const sel = resolveProviderSelection({
      creds: { agentrouterApiKey: "sk-test" },
    });
    expect(sel).toEqual({
      providerId: "agentrouter",
      model: "deepseek-v4-flash",
    });
  });
});
