import { describe, expect, it } from "vitest";
import { BaseProvider, classifyProviderError } from "../base.js";
import type { CompletionRequest, ProviderId, StreamEvent } from "../types.js";

class FlakyProvider extends BaseProvider {
  readonly id: ProviderId = "openai";
  readonly displayName = "Flaky";
  public attempts = 0;

  constructor(private failuresBeforeSuccess: number, private errorCode = 503) {
    super();
  }

  isConfigured(): boolean {
    return true;
  }

  protected async *doStream(_request: CompletionRequest): AsyncGenerator<StreamEvent> {
    this.attempts++;
    if (this.attempts <= this.failuresBeforeSuccess) {
      const err = new Error(`HTTP ${this.errorCode} Service Unavailable`);
      (err as unknown as { status: number }).status = this.errorCode;
      throw err;
    }
    yield { type: "text_delta", text: "success after retry" };
  }
}

const req = (over: Partial<CompletionRequest> = {}): CompletionRequest => ({
  model: "test-model",
  systemPrompt: "",
  messages: [],
  tools: [],
  maxTokens: 64,
  ...over,
});

async function collect(gen: AsyncGenerator<StreamEvent>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

describe("Phase 24.1 & 24.7 - Provider Retry and Error Taxonomy", () => {
  it("retries transient 503 error and succeeds", async () => {
    const provider = new FlakyProvider(1, 503);
    const events = await collect(provider.streamCompletion(req()));
    expect(provider.attempts).toBe(2);
    expect(events.some((e) => e.type === "text_delta" && e.text === "success after retry")).toBe(true);
    expect(events.at(-1)?.type).toBe("turn_end");
  });

  it("does not retry fatal 400 error and fails immediately", async () => {
    const provider = new FlakyProvider(1, 400);
    const events = await collect(provider.streamCompletion(req()));
    expect(provider.attempts).toBe(1);
    expect(events.some((e) => e.type === "error")).toBe(true);
    const errEvent = events.find((e) => e.type === "error") as { type: "error"; isRetryable?: boolean; code?: string };
    expect(errEvent.isRetryable).toBe(false);
  });

  it("fails after exhausting maximum retries on repeated 503s", async () => {
    const provider = new FlakyProvider(5, 503);
    const events = await collect(provider.streamCompletion(req()));
    // Initial attempt + 2 retries = 3 attempts total
    expect(provider.attempts).toBe(3);
    expect(events.some((e) => e.type === "error")).toBe(true);
  });

  it("classifies error status codes into ProviderErrorCode taxonomy", () => {
    expect(classifyProviderError(new Error("Rate limit exceeded 429")).code).toBe("RATE_LIMIT");
    expect(classifyProviderError(new Error("Rate limit exceeded 429")).isRetryable).toBe(true);

    expect(classifyProviderError(new Error("503 Service Unavailable")).code).toBe("SERVER_OVERLOADED");
    expect(classifyProviderError(new Error("503 Service Unavailable")).isRetryable).toBe(true);

    expect(classifyProviderError(new Error("401 Unauthorized invalid api key")).code).toBe("AUTH_FAILED");
    expect(classifyProviderError(new Error("401 Unauthorized invalid api key")).isRetryable).toBe(false);

    expect(classifyProviderError(new Error("404 Model not found")).code).toBe("MODEL_NOT_FOUND");
    expect(classifyProviderError(new Error("404 Model not found")).isRetryable).toBe(false);

    expect(classifyProviderError(new Error("context_length_exceeded")).code).toBe("CONTEXT_OVERFLOW");
    expect(classifyProviderError(new Error("context_length_exceeded")).isRetryable).toBe(false);
  });
});
