import { describe, expect, it } from "vitest";
import { BaseProvider } from "../base.js";
import type { CompletionRequest, ProviderId, StreamEvent } from "../types.js";

class OkProvider extends BaseProvider {
  readonly id: ProviderId = "openai";
  readonly displayName = "TestOk";
  constructor(private configured = true) {
    super();
  }
  isConfigured(): boolean {
    return this.configured;
  }
  protected async *doStream(_request: CompletionRequest): AsyncGenerator<StreamEvent> {
    yield { type: "text_delta", text: "hi" };
  }
}

class BoomProvider extends BaseProvider {
  readonly id: ProviderId = "openai";
  readonly displayName = "TestBoom";
  isConfigured(): boolean {
    return true;
  }
  protected async *doStream(): AsyncGenerator<StreamEvent> {
    throw new Error("wire exploded");
    yield { type: "text_delta", text: "unreachable" };
  }
}

const req = (over: Partial<CompletionRequest> = {}): CompletionRequest => ({
  model: "m",
  systemPrompt: "",
  messages: [],
  tools: [],
  maxTokens: 16,
  ...over,
});

async function collect(gen: AsyncGenerator<StreamEvent>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

describe("BaseProvider", () => {
  it("yields a not-configured error without calling doStream", async () => {
    const p = new OkProvider(false);
    const events = await collect(p.streamCompletion(req()));
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("error");
  });

  it("delegates to doStream and guarantees a turn_end", async () => {
    const p = new OkProvider(true);
    const events = await collect(p.streamCompletion(req()));
    expect(events[0]).toMatchObject({ type: "text_delta", text: "hi" });
    expect(events[events.length - 1].type).toBe("turn_end");
  });

  it("converts a doStream throw into an error event (never throws)", async () => {
    const p = new BoomProvider();
    const events = await collect(p.streamCompletion(req()));
    expect(events[0].type).toBe("error");
    expect((events[0] as { message: string }).message).toContain("wire exploded");
  });
});
