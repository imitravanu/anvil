import { describe, expect, it } from "vitest";
import { createGroqProvider } from "../groq.js";
import { createCerebrasProvider } from "../cerebras.js";
import { createGitHubModelsProvider } from "../github.js";
import { createMistralProvider } from "../mistral.js";
import { createOllamaProvider } from "../ollama.js";
import { translateChatCompletionsChunkStream, type RawOpenAIChunk } from "../openai.js";
import type { ModelProvider, ProviderId, StreamEvent } from "../types.js";

const ADAPTERS: {
  id: ProviderId;
  displayName: string;
  create: (key: string | undefined) => ModelProvider;
}[] = [
  { id: "groq", displayName: "Groq", create: createGroqProvider },
  { id: "cerebras", displayName: "Cerebras", create: createCerebrasProvider },
  { id: "github", displayName: "GitHub Models", create: createGitHubModelsProvider },
  { id: "mistral", displayName: "Mistral AI", create: createMistralProvider },
  { id: "ollama", displayName: "Ollama (Local)", create: createOllamaProvider },
];

async function collect(gen: AsyncGenerator<StreamEvent>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

describe("OpenAI-compat adapters (groq/cerebras/github/mistral/ollama)", () => {
  for (const a of ADAPTERS) {
    it(`${a.id}: wires id/displayName and configured flag`, () => {
      const p = a.create("test-key");
      expect(p.id).toBe(a.id);
      expect(p.displayName).toBe(a.displayName);
      expect(p.isConfigured()).toBe(true);
    });

    it(`${a.id}: unconfigured stream yields a single not-configured error (never throws)`, async () => {
      // Ollama treats OLLAMA_HOST as configuration; force the
      // unconfigured path by clearing it for this assertion only.
      const savedHost = process.env.OLLAMA_HOST;
      if (a.id === "ollama") delete process.env.OLLAMA_HOST;
      try {
        const p = a.create(undefined);
        if (p.isConfigured()) return; // environment-provided key — nothing to assert
        const events = await collect(
          p.streamCompletion({
            model: "m",
            systemPrompt: "",
            messages: [],
            tools: [],
            maxTokens: 8,
          })
        );
        expect(events).toHaveLength(1);
        expect(events[0].type).toBe("error");
        expect((events[0] as { message: string }).message).toContain(a.displayName);
      } finally {
        if (a.id === "ollama") {
          if (savedHost === undefined) delete process.env.OLLAMA_HOST;
          else process.env.OLLAMA_HOST = savedHost;
        }
      }
    });
  }

  it("shared translator: tool-call chunks assemble with usage + tool_use end", async () => {
    async function* raw(): AsyncGenerator<RawOpenAIChunk> {
      yield {
        choices: [
          {
            delta: {
              tool_calls: [{ index: 0, id: "call_1", function: { name: "read_file", arguments: '{"pa' } }],
            },
          },
        ],
      };
      yield {
        choices: [
          {
            delta: {
              tool_calls: [{ index: 0, function: { arguments: 'th": "a.ts"}' } }],
            },
            finish_reason: "tool_calls",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      };
    }
    const events = await collect(translateChatCompletionsChunkStream(raw()));
    const types = events.map((e) => e.type);
    expect(types).toContain("tool_call_start");
    expect(types).toContain("tool_call_end");
    expect(types).toContain("usage");
    expect(events[events.length - 1]).toMatchObject({ type: "turn_end", stopReason: "tool_use" });
    const end = events.find((e) => e.type === "tool_call_end") as Extract<StreamEvent, { type: "tool_call_end" }>;
    expect(end.input).toEqual({ path: "a.ts" });
  });
});
