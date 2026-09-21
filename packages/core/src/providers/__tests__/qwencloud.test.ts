import { afterEach, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createChatCompletionsStyleProvider } from "../openai.js";
import {
  QWENCLOUD_BASE_URL,
  createQwenCloudProvider,
  qwencloudProviderOptions,
} from "../qwencloud.js";
import { getModelsForProvider } from "../registry.js";
import type { StreamEvent } from "../types.js";

describe("qwencloud adapter", () => {
  let server: http.Server | null = null;
  let receivedBody: Record<string, unknown> | null = null;

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = null;
    }
    receivedBody = null;
  });

  async function startStub(): Promise<string> {
    server = http.createServer((req, res) => {
      let raw = "";
      req.on("data", (chunk) => {
        raw += chunk;
      });
      req.on("end", () => {
        receivedBody = JSON.parse(raw) as Record<string, unknown>;
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.end(
          'data: {"choices":[{"delta":{"content":"Hello from Qwen"},"finish_reason":null}]}\n\n' +
            'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n' +
            "data: [DONE]\n\n"
        );
      });
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  }

  async function collect(gen: AsyncGenerator<StreamEvent>): Promise<StreamEvent[]> {
    const out: StreamEvent[] = [];
    for await (const e of gen) out.push(e);
    return out;
  }

  it("adapter wiring carries production base URL, display name, and vision support", () => {
    const opts = qwencloudProviderOptions("test-key");
    expect(opts.id).toBe("qwencloud");
    expect(opts.displayName).toBe("QwenCloud");
    expect(opts.baseURL).toBe(QWENCLOUD_BASE_URL);
    expect(opts.maxTokensParam).toBe("max_tokens");
    expect(opts.supportsVision).toBe(true);
  });

  it("createQwenCloudProvider respects key presence", () => {
    const withKey = createQwenCloudProvider("sk-test");
    expect(withKey.isConfigured()).toBe(true);
    expect(withKey.id).toBe("qwencloud");
    expect(withKey.displayName).toBe("QwenCloud");

    const withoutKey = createQwenCloudProvider(undefined);
    expect(withoutKey.isConfigured()).toBe(false);
  });

  it("streams completion against stub server", async () => {
    const baseURL = await startStub();
    const provider = createChatCompletionsStyleProvider({
      ...qwencloudProviderOptions("test-key"),
      baseURL,
    });
    const events = await collect(
      provider.streamCompletion({
        model: "qwen3.8-flash",
        systemPrompt: "You are an assistant.",
        messages: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
        tools: [],
        maxTokens: 512,
      })
    );
    expect(receivedBody?.model).toBe("qwen3.8-flash");
    expect(events).toContainEqual({ type: "text_delta", text: "Hello from Qwen" });
    expect(events).toContainEqual({ type: "turn_end", stopReason: "end_turn" });
  });

  it("registers key QwenCloud models in MODEL_REGISTRY", () => {
    const models = getModelsForProvider("qwencloud");
    expect(models.length).toBeGreaterThanOrEqual(15);

    const ids = models.map((m) => m.id);
    expect(ids).toContain("qwen3.8-max");
    expect(ids).toContain("qwen3.8-flash");
    expect(ids).toContain("qwq-plus");
    expect(ids).toContain("qwen3-coder-plus");
    expect(ids).toContain("deepseek-v4.1-flash");
    expect(ids).toContain("glm-5.3");
    expect(ids).toContain("kimi-k3");

    for (const m of models) {
      expect(m.providerId).toBe("qwencloud");
      expect(m.isFree).toBe(true);
    }
    // Live-probed 2026-09-22: qwq-plus streams but answers tool prompts in
    // prose — supportsTools is false so default-pick never lands on it.
    const qwq = models.find((m) => m.id === "qwq-plus");
    expect(qwq?.supportsTools).toBe(false);
    expect(qwq?.certified).toBe("live");
    // Everything else audited live with a real tool round-trip.
    expect(models.find((m) => m.id === "qwen3.8-flash")?.certified).toBe("live");
    expect(models.find((m) => m.id === "kimi-k3")?.supportsTools).toBe(true);
  });
});
