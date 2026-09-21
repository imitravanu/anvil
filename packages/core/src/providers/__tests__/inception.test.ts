import { afterEach, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createChatCompletionsStyleProvider } from "../openai.js";
import { INCEPTION_BASE_URL, inceptionProviderOptions } from "../inception.js";
import { INCEPTION_MIN_COMPLETION_TOKENS } from "../../config/constants.js";
import type { StreamEvent } from "../types.js";

// Mercury reasons (~250 tokens) before emitting anything: a small caller
// budget returns an empty length-cutoff turn. These tests drive the real
// OpenAI SDK against a stub HTTP server (no prod-code mocks) using the
// adapter's exact factory options — only the baseURL points at the stub.
describe("inception token floor", () => {
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
          'data: {"choices":[{"delta":{"content":"hi"},"finish_reason":null}]}\n\n' +
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

  it("floors a 50-token cert-size budget to the reasoning headroom", async () => {
    const baseURL = await startStub();
    const provider = createChatCompletionsStyleProvider({
      ...inceptionProviderOptions("test-key"),
      baseURL,
    });
    const events = await collect(
      provider.streamCompletion({
        model: "mercury-2.5",
        systemPrompt: "",
        messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
        tools: [],
        maxTokens: 50,
      })
    );
    expect(receivedBody?.["max_tokens"]).toBe(INCEPTION_MIN_COMPLETION_TOKENS);
    expect(events).toContainEqual({ type: "text_delta", text: "hi" });
  });

  it("leaves budgets above the floor untouched", async () => {
    const baseURL = await startStub();
    const provider = createChatCompletionsStyleProvider({
      ...inceptionProviderOptions("test-key"),
      baseURL,
    });
    await collect(
      provider.streamCompletion({
        model: "mercury-2.5",
        systemPrompt: "",
        messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
        tools: [],
        maxTokens: 4096,
      })
    );
    expect(receivedBody?.["max_tokens"]).toBe(4096);
  });

  it("adapter wiring carries the production base URL and floor", () => {
    const opts = inceptionProviderOptions("test-key");
    expect(opts.baseURL).toBe(INCEPTION_BASE_URL);
    expect(opts.maxTokensParam).toBe("max_tokens");
    expect(opts.maxTokensFloor).toBe(INCEPTION_MIN_COMPLETION_TOKENS);
  });
});
