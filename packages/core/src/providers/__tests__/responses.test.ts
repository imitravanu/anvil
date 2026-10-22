import { afterEach, describe, expect, it, vi } from "vitest";
import { ResponsesStyleProvider } from "../responses.js";
import type { CompletionRequest, StreamEvent } from "../types.js";

const req: CompletionRequest = { model: "fixture", messages: [], tools: [], maxTokens: 64, systemPrompt: "" };
const provider = () => new ResponsesStyleProvider({ id: "custom:fixture", displayName: "Fixture", baseURL: "https://fixture.invalid/v1", apiKey: "fixture" });
const collect = async (stream: AsyncIterable<StreamEvent>) => { const events = []; for await (const event of stream) events.push(event); return events; };
afterEach(() => vi.restoreAllMocks());

describe("Responses terminal states and cleanup", () => {
  it.each(["response.completed", "response.incomplete", "response.failed"])("keeps usage for %s and closes the live body", async type => {
    const cancel = vi.fn();
    const body = new ReadableStream({ start(controller) {
      const events = [
        { type: "response.output_text.delta", delta: "partial" },
        { type, response: { usage: { input_tokens: 7, output_tokens: 64 }, incomplete_details: { reason: "max_output_tokens" }, error: { message: "fixture failure" } } },
      ];
      controller.enqueue(new TextEncoder().encode(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join("")));
    }, cancel });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(body));
    const events = await collect(provider().streamCompletion(req));
    expect(events).toContainEqual({ type: "usage", inputTokens: 7, outputTokens: 64 });
    expect(events.at(-1)).toEqual(type === "response.failed" ? { type: "error", message: "fixture failure" } : { type: "turn_end", stopReason: type === "response.incomplete" ? "max_tokens" : "end_turn" });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("cancels the response when a consumer stops at an error", async () => {
    const cancel = vi.fn();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"type":"error","message":"fixture failure"}\n\n'));
    }, cancel })));
    for await (const _ of provider().streamCompletion(req)) break;
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("preserves cancellation during a blocked read", async () => {
    const controller = new AbortController();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, options) => new Response(new ReadableStream({ start(stream) {
      options?.signal?.addEventListener("abort", () => stream.error(new Error("aborted")), { once: true });
    } })));
    const stream = provider().streamCompletion({ ...req, signal: controller.signal });
    const next = stream.next();
    await new Promise(resolve => setImmediate(resolve));
    controller.abort();
    expect((await next).value).toMatchObject({ type: "error" });
    await stream.return(undefined);
  });
});
