import { describe, expect, it } from "vitest";
import { createMockCertificationProvider } from "../mockProvider.js";
import {
  certifyProvider,
  certifyAllProviders,
  PROVIDER_CERT_MODELS,
  resolveCertificationCredentials,
} from "../runner.js";
import { getLatestCertificationDate } from "../../providers/registry.js";
import type { ProviderId } from "../../providers/types.js";

describe("Phase 18: Provider Certification Harness", () => {
  it("certifies a healthy provider as live with all 5 criteria passing", async () => {
    const mock = createMockCertificationProvider("gemini");
    const result = await certifyProvider(mock, { timeoutMs: 5000 });

    expect(result.passed).toBe(true);
    expect(result.status).toBe("live");
    expect(result.providerId).toBe("gemini");
    expect(result.model).toBe(PROVIDER_CERT_MODELS.gemini);

    expect(result.criteria.streaming.passed).toBe(true);
    expect(result.criteria.toolCalls.passed).toBe(true);
    expect(result.criteria.multiTurn.passed).toBe(true);
    expect(result.criteria.errorPath.passed).toBe(true);
    expect(result.criteria.rateLimit.passed).toBe(true);
  });

  it("marks unconfigured provider as untested without crashing", async () => {
    const mock = createMockCertificationProvider("anthropic", { isConfigured: false });
    const result = await certifyProvider(mock);

    expect(result.passed).toBe(false);
    expect(result.status).toBe("untested");
    expect(result.error).toContain("not configured");
    expect(result.criteria.streaming.passed).toBe(false);
  });

  it("marks provider as broken when streaming yields no text", async () => {
    const mock = createMockCertificationProvider("groq", {
      failCriteria: new Set(["streaming"]),
    });
    const result = await certifyProvider(mock, { timeoutMs: 5000 });

    expect(result.passed).toBe(false);
    expect(result.status).toBe("broken");
    expect(result.criteria.streaming.passed).toBe(false);
    expect(result.criteria.streaming.error).toContain("No text_delta");
    // Other criteria still evaluate
    expect(result.criteria.toolCalls.passed).toBe(true);
    expect(result.criteria.rateLimit.passed).toBe(true);
  });

  it("marks provider as broken when tool calling fails", async () => {
    const mock = createMockCertificationProvider("openai", {
      failCriteria: new Set(["toolCalls"]),
    });
    const result = await certifyProvider(mock, { timeoutMs: 5000 });

    expect(result.passed).toBe(false);
    expect(result.status).toBe("broken");
    expect(result.criteria.toolCalls.passed).toBe(false);
    expect(result.criteria.toolCalls.error).toContain("Provider did not call tool");
    expect(result.criteria.streaming.passed).toBe(true);
  });

  it("marks provider as broken when 3-turn continuity fails", async () => {
    const mock = createMockCertificationProvider("mistral", {
      failCriteria: new Set(["multiTurn"]),
    });
    const result = await certifyProvider(mock, { timeoutMs: 5000 });

    expect(result.passed).toBe(false);
    expect(result.status).toBe("broken");
    expect(result.criteria.multiTurn.passed).toBe(false);
    expect(result.criteria.multiTurn.error).toContain("failed to recall secret code word");
  });

  it("verifies error containment on 404/invalid model", async () => {
    const mock = createMockCertificationProvider("cerebras");
    const result = await certifyProvider(mock, { timeoutMs: 5000 });

    expect(result.criteria.errorPath.passed).toBe(true);
    expect(result.criteria.errorPath.details).toContain("Clean error event");
  });

  it("certifies all 10 providers in batch with mock instances", async () => {
    const providers: Record<ProviderId, ReturnType<typeof createMockCertificationProvider>> = {
      anthropic: createMockCertificationProvider("anthropic"),
      openai: createMockCertificationProvider("openai"),
      gemini: createMockCertificationProvider("gemini"),
      openrouter: createMockCertificationProvider("openrouter"),
      orcarouter: createMockCertificationProvider("orcarouter"),
      groq: createMockCertificationProvider("groq"),
      cerebras: createMockCertificationProvider("cerebras"),
      github: createMockCertificationProvider("github"),
      mistral: createMockCertificationProvider("mistral"),
      ollama: createMockCertificationProvider("ollama"),
    };

    const results = await certifyAllProviders(providers, { timeoutMs: 5000 });

    expect(Object.keys(results)).toHaveLength(10);
    for (const [id, res] of Object.entries(results)) {
      expect(res.passed).toBe(true);
      expect(res.status).toBe("live");
      expect(res.providerId).toBe(id);
    }
  });

  it("resolves certification credentials without throwing", () => {
    const creds = resolveCertificationCredentials();
    expect(typeof creds).toBe("object");
  });

  it("retrieves the latest certification timestamp from registry", () => {
    const latest = getLatestCertificationDate();
    expect(latest).toBeTruthy();
    expect(typeof latest).toBe("string");
  });
});
