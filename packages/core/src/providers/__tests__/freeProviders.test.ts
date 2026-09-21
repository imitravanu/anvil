import { describe, expect, it } from "vitest";
import {
  createProviders,
  getModelsForProvider,
  MODEL_REGISTRY,
} from "../index.js";
import { resolveProviderSelection } from "../../config/index.js";

describe("Free Providers Integration", () => {
  it("creates instances for all free providers", () => {
    const providers = createProviders({
      groqApiKey: "gsk_test",
      githubApiKey: "ghp_test",
      cerebrasApiKey: "csk_test",
      mistralApiKey: "mis_test",
      inceptionApiKey: "sk_test",
      ollamaApiKey: "ollama",
    });

    expect(providers.groq.id).toBe("groq");
    expect(providers.groq.isConfigured()).toBe(true);

    expect(providers.github.id).toBe("github");
    expect(providers.github.isConfigured()).toBe(true);

    expect(providers.cerebras.id).toBe("cerebras");
    expect(providers.cerebras.isConfigured()).toBe(true);

    expect(providers.mistral.id).toBe("mistral");
    expect(providers.mistral.isConfigured()).toBe(true);

    expect(providers.inception.id).toBe("inception");
    expect(providers.inception.isConfigured()).toBe(true);

    expect(providers.ollama.id).toBe("ollama");
    expect(providers.ollama.isConfigured()).toBe(true);
  });

  it("reports unconfigured when keys are missing", () => {
    const providers = createProviders({});
    expect(providers.groq.isConfigured()).toBe(false);
    expect(providers.github.isConfigured()).toBe(false);
    expect(providers.cerebras.isConfigured()).toBe(false);
    expect(providers.mistral.isConfigured()).toBe(false);
    expect(providers.inception.isConfigured()).toBe(false);
    expect(providers.ollama.isConfigured()).toBe(false);
  });

  it("registers free models for each free provider in MODEL_REGISTRY", () => {
    const freeProviders = ["groq", "github", "cerebras", "mistral", "inception", "ollama"] as const;
    for (const pid of freeProviders) {
      const models = getModelsForProvider(pid);
      expect(models.length).toBeGreaterThan(0);
      for (const m of models) {
        expect(m.isFree).toBe(true);
        expect(m.supportsTools).toBe(true);
      }
    }
  });

  it("resolves default model for groq when groq is the configured provider", () => {
    const sel = resolveProviderSelection({
      creds: { groqApiKey: "gsk_test" },
    });
    expect(sel).toEqual({
      providerId: "groq",
      model: "llama-3.3-70b-versatile",
    });
  });

  it("resolves default model for github models when github is configured", () => {
    const sel = resolveProviderSelection({
      creds: { githubApiKey: "ghp_test" },
    });
    expect(sel).toEqual({
      providerId: "github",
      model: "gpt-4o-mini",
    });
  });

  it("resolves default model for cerebras when cerebras is configured", () => {
    const sel = resolveProviderSelection({
      creds: { cerebrasApiKey: "csk_test" },
    });
    expect(sel).toEqual({
      providerId: "cerebras",
      model: "llama3.3-70b",
    });
  });

  it("resolves default model for inception when inception is configured", () => {
    const sel = resolveProviderSelection({
      creds: { inceptionApiKey: "sk_test" },
    });
    expect(sel).toEqual({
      providerId: "inception",
      model: "mercury-2.5",
    });
  });
});
