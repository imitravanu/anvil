import { afterEach, describe, expect, it } from "vitest";
import { createGroqProvider, GROQ_BASE_URL } from "../groq.js";
import { createCerebrasProvider, CEREBRAS_BASE_URL } from "../cerebras.js";
import { createGitHubModelsProvider, GITHUB_MODELS_BASE_URL } from "../github.js";
import { createMistralProvider, MISTRAL_BASE_URL } from "../mistral.js";
import {
  createOllamaProvider,
  ollamaBaseURL,
  OLLAMA_DEFAULT_BASE_URL,
} from "../ollama.js";

// Table-driven coverage for the five OpenAI-compatible adapters, which
// previously had zero tests (only id/isConfigured were checked anywhere).
describe("compat adapters", () => {
  it("exposes stable base URLs and ids", () => {
    expect(GROQ_BASE_URL).toBe("https://api.groq.com/openai/v1");
    expect(CEREBRAS_BASE_URL).toBe("https://api.cerebras.ai/v1");
    expect(GITHUB_MODELS_BASE_URL).toContain("azure.com");
    expect(MISTRAL_BASE_URL).toBe("https://api.mistral.ai/v1");
    expect(OLLAMA_DEFAULT_BASE_URL).toBe("http://localhost:11434/v1");
    expect(createGroqProvider("k").id).toBe("groq");
    expect(createCerebrasProvider("k").id).toBe("cerebras");
    expect(createGitHubModelsProvider("k").id).toBe("github");
    expect(createMistralProvider("k").id).toBe("mistral");
    expect(createOllamaProvider("k").id).toBe("ollama");
  });

  it("ollama isConfigured without a key when OLLAMA_HOST is set", () => {
    process.env.OLLAMA_HOST = "http://lan:11434";
    try {
      expect(createOllamaProvider(undefined).isConfigured()).toBe(true);
    } finally {
      delete process.env.OLLAMA_HOST;
    }
    expect(createOllamaProvider(undefined).isConfigured()).toBe(false);
    expect(createOllamaProvider("k").isConfigured()).toBe(true);
  });

  describe("ollamaBaseURL", () => {
    const saved = process.env.OLLAMA_HOST;
    afterEach(() => {
      if (saved === undefined) delete process.env.OLLAMA_HOST;
      else process.env.OLLAMA_HOST = saved;
    });

    it("defaults when unset and tolerates /v1 suffixes and slashes", () => {
      delete process.env.OLLAMA_HOST;
      expect(ollamaBaseURL()).toBe("http://localhost:11434/v1");
      process.env.OLLAMA_HOST = "http://lan:11434";
      expect(ollamaBaseURL()).toBe("http://lan:11434/v1");
      process.env.OLLAMA_HOST = "http://lan:11434///";
      expect(ollamaBaseURL()).toBe("http://lan:11434/v1");
      process.env.OLLAMA_HOST = "http://lan:11434/v1";
      expect(ollamaBaseURL()).toBe("http://lan:11434/v1");
      process.env.OLLAMA_HOST = "http://lan:11434/v1/";
      expect(ollamaBaseURL()).toBe("http://lan:11434/v1");
    });
  });
});
