import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createCustomProvider, customProviderModels, fetchCustomProviderModels, refreshCustomProviderModels, saveCustomProvider, validateCustomProvider, type CustomProviderConfig } from "../custom.js";
import { createProviders } from "../index.js";
import { getModelsForProvider } from "../registry.js";
import { resolveProviderSelection } from "../../config/index.js";
import { CUSTOM_DISCOVERY_MAX_BYTES, FALLBACK_CONTEXT_WINDOW } from "../../config/constants.js";
import type { CompletionRequest } from "../types.js";

let root: string;
const cfg = (extra: Partial<CustomProviderConfig> = {}): CustomProviderConfig => ({ id: "custom:completion", name: "Completion", baseUrl: "https://fixture.invalid/v1", auth: "none", ...extra });
const request = (model: string): CompletionRequest => ({ model, messages: [{ role: "user", content: [{ type: "text", text: "Hello" }] }], tools: [{ name: "read_file", description: "Read", inputSchema: { type: "object" }, mutating: false }], maxTokens: 64, systemPrompt: "fixture" });
const sse = (events: any[]) => new Response(events.map(event => `${event.type ? `event: ${event.type}\n` : ""}data: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
const anthropicEvents = (text: string) => [
  { type: "message_start", message: { id: "msg-fixture", type: "message", role: "assistant", model: "fixture", content: [], usage: { input_tokens: 3, output_tokens: 0 } } },
  { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
  { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
  { type: "content_block_stop", index: 0 },
  { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 4 } },
  { type: "message_stop" },
];
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-completion-"));
  vi.stubEnv("ANVIL_HOME", root);
});
afterEach(() => {
  createProviders({}, []);
  vi.restoreAllMocks(); vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("custom-provider completion regressions", () => {
  it("checks each effective model route and names missing environment references", async () => {
    vi.stubEnv("AUDIT_ROUTE_TOKEN", "");
    const config = cfg({ models: [
      { id: "blocked", contextWindow: 8192, headers: { "X-Api-Key": "$AUDIT_ROUTE_TOKEN" } },
      { id: "ready", contextWindow: 8192 },
    ] });
    const provider = createCustomProvider(config);
    expect(provider.isConfigured()).toBe(true);
    expect(provider.isConfigured("ready")).toBe(true);
    expect(provider.isConfigured("blocked")).toBe(false);
    expect(provider.configurationIssue?.("blocked")).toContain("AUDIT_ROUTE_TOKEN");
    expect(provider.configurationIssue?.("ready")).toBeNull();
    const fetcher = vi.spyOn(globalThis, "fetch");
    const events = [];
    for await (const event of provider.streamCompletion(request("blocked"))) events.push(event);
    expect(events).toContainEqual(expect.objectContaining({ type: "error", code: "AUTH_FAILED", message: expect.stringContaining("AUDIT_ROUTE_TOKEN") }));
    expect(fetcher).not.toHaveBeenCalled();
    const overridden = createCustomProvider(cfg({ headers: { "X-Api-Key": "$AUDIT_ROUTE_TOKEN" }, models: [
      { id: "ready", contextWindow: 8192, headers: { "x-api-key": "$AUDIT_WORKING_TOKEN" } },
    ] }));
    vi.stubEnv("AUDIT_WORKING_TOKEN", "secret-only-in-env");
    expect(overridden.isConfigured("ready")).toBe(true);
  });
  it.each([undefined, []])("discovers an omitted/empty model list into selection and the registry (%s)", async models => {
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: [{ id: "live-model" }, { id: "live-model" }, { id: 42 }, { id: "bad-context", context_length: -1 }] })));
    const config = validateCustomProvider(cfg({ models }));
    saveCustomProvider(config);
    expect(customProviderModels([config])).toEqual([]);
    expect(() => resolveProviderSelection({ flagProvider: config.id, creds: {} })).toThrow("No models available");
    expect(await refreshCustomProviderModels()).toEqual([{ providerId: config.id, count: 2 }]);
    createProviders({}); // Rebuilding adapters must not erase the discovered rows.
    expect(getModelsForProvider(config.id).map(m => m.id)).toEqual(["live-model", "bad-context"]);
    expect(customProviderModels([config])[0].contextWindow).toBe(FALLBACK_CONTEXT_WINDOW);
    expect(resolveProviderSelection({ flagProvider: config.id, creds: {} })).toEqual({ providerId: config.id, model: "live-model" });
    await refreshCustomProviderModels();
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockResolvedValue(new Response(JSON.stringify({ data: [{ id: "replacement" }] })));
    await refreshCustomProviderModels(undefined, { force: true });
    expect(getModelsForProvider(config.id).map(m => m.id)).toEqual(["replacement"]);
    fetcher.mockResolvedValue(new Response("unavailable", { status: 503 }));
    expect((await refreshCustomProviderModels(undefined, { force: true }))[0].error).toContain("HTTP 503");
    expect(getModelsForProvider(config.id).map(m => m.id)).toEqual(["replacement"]);
  });

  it("bounds catalog size, refuses redirects and propagates cancellation", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("x".repeat(CUSTOM_DISCOVERY_MAX_BYTES + 1)));
    await expect(fetchCustomProviderModels(cfg())).rejects.toThrow("size limit");
    const controller = new AbortController(); controller.abort();
    fetcher.mockImplementation(async (_url, init) => {
      expect(init?.redirect).toBe("error");
      expect(init?.signal?.aborted).toBe(true);
      throw new Error("fixture aborted");
    });
    await expect(fetchCustomProviderModels(cfg(), undefined, controller.signal)).rejects.toThrow("aborted");
  });

  it("keeps echoed keys out of discovery failures", async () => {
    saveCustomProvider(cfg({ auth: "bearer" }), "discovery-secret");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response('discovery-secret', { status: 401 }));
    const result = await refreshCustomProviderModels();
    expect(JSON.stringify(result)).not.toContain("discovery-secret");
    expect(result[0].error).toContain("HTTP 401");
  });

  it.each(["https://fixture.invalid", "https://fixture.invalid/v1", "https://fixture.invalid/proxy/v1/"])("uses exactly one /v1 and no inherited auth for Anthropic at %s", async baseUrl => {
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "unrelated-bearer");
    vi.stubEnv("ANTHROPIC_API_KEY", "unrelated-key");
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const req = input instanceof Request ? input : new Request(input, init);
      expect(req.url).toBe(baseUrl.includes("proxy") ? "https://fixture.invalid/proxy/v1/messages" : "https://fixture.invalid/v1/messages");
      expect(req.headers.has("x-api-key")).toBe(false);
      expect(req.headers.has("authorization")).toBe(false);
      expect(init?.redirect).toBe("error");
      return sse(anthropicEvents("anthropic works"));
    });
    const events = [];
    for await (const event of createCustomProvider(cfg({ baseUrl, protocol: "anthropic" })).streamCompletion(request("claude-fixture"))) events.push(event);
    expect(events).toContainEqual({ type: "text_delta", text: "anthropic works" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("routes three models over different protocols/endpoints and merges headers case-insensitively", async () => {
    vi.stubEnv("MODEL_TOKEN", "model-header-secret");
    const captures: Array<{ url: string; headers: Headers; body: any }> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const req = input instanceof Request ? input : new Request(input, init);
      captures.push({ url: req.url, headers: req.headers, body: await req.json() });
      if (req.url.endsWith("/chat/completions")) return sse([{ choices: [{ delta: { content: "chat works" }, finish_reason: "stop" }] }]);
      if (req.url.endsWith("/responses")) return sse([
        { type: "response.output_item.added", item: { id: "item1", type: "function_call", call_id: "call1", name: "read_file" } },
        { type: "response.function_call_arguments.delta", item_id: "item1", delta: '{"path":"a"}' },
        { type: "response.function_call_arguments.done", item_id: "item1", arguments: '{"path":"a"}' },
        { type: "response.output_item.done", item: { id: "item1", type: "function_call", call_id: "call1", name: "read_file", arguments: '{"path":"a"}' } },
        { type: "response.completed", response: { usage: { input_tokens: 3, output_tokens: 5 } } },
      ]);
      return sse(anthropicEvents("third wire works"));
    });
    const config = validateCustomProvider(cfg({ headers: { "X-Client": "parent" }, models: [
      { id: "chat", contextWindow: 8192 },
      { id: "responses", contextWindow: 8192, protocol: "openai-responses", baseUrl: "https://responses.invalid/v1", headers: { "x-client": "child", "X-Api-Key": "$MODEL_TOKEN" } },
      { id: "anthropic", contextWindow: 8192, protocol: "anthropic", baseUrl: "https://anthropic.invalid/v1", supportsTools: false },
    ] }));
    const provider = createCustomProvider(config);
    const events = [];
    for (const id of ["chat", "responses", "anthropic"]) for await (const event of provider.streamCompletion(request(id))) events.push(event);
    expect(captures.map(c => c.url)).toEqual(["https://fixture.invalid/v1/chat/completions", "https://responses.invalid/v1/responses", "https://anthropic.invalid/v1/messages"]);
    expect(captures[1].headers.get("x-client")).toBe("child");
    expect(captures[1].headers.get("x-api-key")).toBe("model-header-secret");
    expect(captures[1].headers.has("authorization")).toBe(false);
    expect(captures[0].headers.has("x-api-key")).toBe(false);
    expect(captures[2].body).not.toHaveProperty("tools");
    expect(events).toContainEqual(expect.objectContaining({ type: "tool_call_end", id: "call1", input: { path: "a" } }));
  });

  it("rejects unsafe per-model overrides without exposing their contents", () => {
    for (const extra of [{ baseUrl: "https://user:secret@fixture.invalid" }, { headers: { Authorization: "secret" } }, { headers: { "X-Api-Key": "secret" } }, { protocol: "invalid" }]) {
      expect(() => validateCustomProvider(cfg({ models: [{ id: "m", contextWindow: 8192, ...extra }] } as any))).toThrow("Invalid custom provider");
    }
  });

  it("honors explicit Anthropic header authentication without inheriting environment credentials", async () => {
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "unrelated-token");
    vi.stubEnv("CUSTOM_NATIVE_KEY", "explicit-header-key");
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const req = input instanceof Request ? input : new Request(input, init);
      expect(req.headers.get("x-api-key")).toBe("explicit-header-key");
      expect(req.headers.has("authorization")).toBe(false);
      return sse(anthropicEvents("header auth works"));
    });
    const events = [];
    for await (const event of createCustomProvider(cfg({ protocol: "anthropic", headers: { "X-Api-Key": "$CUSTOM_NATIVE_KEY" } })).streamCompletion(request("fixture"))) events.push(event);
    expect(events).toContainEqual({ type: "text_delta", text: "header auth works" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
