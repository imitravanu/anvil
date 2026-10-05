import { describe, expect, it, vi } from "vitest";
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

class DeltaThenThrowProvider extends BaseProvider {
  readonly id: ProviderId = "openai";
  readonly displayName = "TestDeltaThenThrow";
  attempts = 0;
  isConfigured(): boolean {
    return true;
  }
  protected async *doStream(): AsyncGenerator<StreamEvent> {
    this.attempts += 1;
    yield { type: "text_delta", text: "one" };
    yield { type: "text_delta", text: "two" };
    // Mid-stream network death AFTER observable deltas — retryable class.
    throw new Error("HTTP 503 connection reset");
  }
}

class StalledErrorStreamProvider extends BaseProvider {
  readonly id: ProviderId = "openai";
  readonly displayName = "TestStalledErrorStream";
  attempts = 0;
  firstAttemptClosed = false;
  isConfigured(): boolean {
    return true;
  }
  protected async *doStream(): AsyncGenerator<StreamEvent> {
    this.attempts += 1;
    if (this.attempts === 1) {
      try {
        // First event is a retryable error; the underlying stream stays OPEN
        // afterwards (suspended at a yield — still able to produce events).
        yield { type: "error", message: "HTTP 503 overloaded" };
        await new Promise((r) => setTimeout(r, 50));
        yield { type: "text_delta", text: "stale" };
        yield { type: "turn_end", stopReason: "end_turn" };
      } finally {
        this.firstAttemptClosed = true;
      }
    }
    yield { type: "text_delta", text: "ok" };
    yield { type: "turn_end", stopReason: "end_turn" };
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

  it("S2.2: does not re-deliver deltas when a mid-stream error triggers retry", async () => {
    const p = new DeltaThenThrowProvider();
    const events = await collect(p.streamCompletion(req()));
    const deltas = events.filter((e) => e.type === "text_delta");
    // Pre-fix: the catch-path retry re-ran the stream after two deltas were
    // already consumed, replaying "one"/"two" a second time (4 deltas).
    expect(deltas).toEqual([
      { type: "text_delta", text: "one" },
      { type: "text_delta", text: "two" },
    ]);
    expect(events[events.length - 1].type).toBe("error");
  });

  it("S2.2: closes the abandoned iterator before retrying on a first-event error", async () => {
    const p = new StalledErrorStreamProvider();
    const events = await collect(p.streamCompletion(req()));
    // The retry succeeded and its events flowed through.
    expect(events.some((e) => e.type === "text_delta")).toBe(true);
    expect(events[events.length - 1].type).toBe("turn_end");
    // The stale attempt produced nothing after its error event.
    expect(events.some((e) => e.type === "text_delta" && e.text === "stale")).toBe(false);
    // The first attempt's stream (still open after the error event) was
    // explicitly closed — its finally ran — instead of leaking mid-flight.
    expect(p.firstAttemptClosed).toBe(true);
  });

  it("paces retries from the named backoff constant, not an inline literal (rule 2.4)", async () => {
    // The schedule used to be `Math.min(50 * Math.pow(2, attempt), 2000)` written
    // inline. Overriding the constant before a FRESH module evaluation is what
    // makes this fail-first: a raw literal ignores the override, retries after
    // ~50ms, and the elapsed-time floor below cannot be met.
    vi.resetModules();
    const configured = 400;
    process.env.ANVIL_PROVIDER_RETRY_DELAY_MS = String(configured);
    try {
      const { BaseProvider: FreshBase } = await import("../base.js");
      const constants = await import("../../config/constants.js");
      expect(constants.PROVIDER_RETRY_INITIAL_DELAY_MS).toBe(configured);

      let attempts = 0;
      class ConfiguredBackoff extends FreshBase {
        readonly id: ProviderId = "openai";
        readonly displayName = "TestConfiguredBackoff";
        isConfigured(): boolean {
          return true;
        }
        protected async *doStream(): AsyncGenerator<StreamEvent> {
          attempts += 1;
          if (attempts === 1) {
            yield { type: "error", message: "HTTP 503 overloaded" };
            return;
          }
          yield { type: "text_delta", text: "ok" };
          yield { type: "turn_end", stopReason: "end_turn" };
        }
      }

      const events: StreamEvent[] = [];
      const started = Date.now();
      for await (const e of new ConfiguredBackoff().streamCompletion(req())) events.push(e);
      const elapsed = Date.now() - started;
      expect(attempts).toBe(2);
      expect(events.some((e) => e.type === "text_delta" && e.text === "ok")).toBe(true);
      expect(elapsed, "a 50ms literal could not pace a 400ms backoff").toBeGreaterThanOrEqual(
        configured - 50
      );
    } finally {
      delete process.env.ANVIL_PROVIDER_RETRY_DELAY_MS;
      vi.resetModules();
    }
  });
});
