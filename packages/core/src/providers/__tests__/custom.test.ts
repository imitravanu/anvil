import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  loadCustomProviders, saveCustomProvider, removeCustomProvider, validateCustomProvider,
  isCustomProviderConfigured, customProviderModels, fetchCustomProviderModels, testCustomProvider,
  type CustomProviderConfig,
} from "../custom.js";
import { createProviders } from "../index.js";
import { getModel, visibleModels } from "../registry.js";
import { hasAnyConfiguredProvider, resolveProviderSelection, saveSettings, loadSettings } from "../../config/index.js";
import { AgentSession } from "../../agent/session.js";
import { saveSession, loadSession } from "../../session/store.js";
import type { CompletionRequest, StreamEvent } from "../types.js";

let root: string;
const closes: Array<() => Promise<void>> = [];
const config = (extra: Partial<CustomProviderConfig> = {}): CustomProviderConfig => ({
  id: "custom:gateway", name: "My Gateway", baseUrl: "https://fixture.invalid/v1",
  auth: "none", models: [{ id: "gpt-4o-mini", contextWindow: 8192 }], ...extra,
});
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-custom-"));
  vi.stubEnv("ANVIL_HOME", root);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(closes.splice(0).map(close => close()));
  createProviders({}, []);
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("custom provider configuration", () => {
  it("stores keys separately with owner-only permissions and registers the provider", () => {
    saveCustomProvider(config({ auth: "bearer" }), "secret-fixture");
    const saved = fs.readFileSync(path.join(root, "providers.json"), "utf8");
    expect(saved).not.toContain("secret-fixture");
    expect(fs.readFileSync(path.join(root, "provider-keys.json"), "utf8")).toContain("secret-fixture");
    if (process.platform !== "win32") {
      for (const file of ["providers.json", "provider-keys.json"]) expect(fs.statSync(path.join(root, file)).mode & 0o777).toBe(0o600);
    }
    expect(createProviders({})["custom:gateway"].isConfigured()).toBe(true);
    expect(loadCustomProviders()[0].name).toBe("My Gateway");
  });

  it("supports keyless endpoints, env authentication and secret-header references", () => {
    saveCustomProvider(config());
    expect(hasAnyConfiguredProvider({})).toBe(true);
    expect(resolveProviderSelection({ creds: {} })).toEqual({ providerId: "custom:gateway", model: "gpt-4o-mini" });
    saveCustomProvider(config({ auth: "bearer", apiKeyEnv: "CUSTOM_FIXTURE_KEY", headers: { "X-Api-Key": "$CUSTOM_FIXTURE_HEADER" } }));
    expect(isCustomProviderConfigured(loadCustomProviders()[0])).toBe(false);
    vi.stubEnv("CUSTOM_FIXTURE_KEY", "env-secret");
    vi.stubEnv("CUSTOM_FIXTURE_HEADER", "header-secret");
    expect(isCustomProviderConfigured(loadCustomProviders()[0])).toBe(true);
    expect(fs.readFileSync(path.join(root, "providers.json"), "utf8")).not.toContain("env-secret");
  });

  it("requires credentials for bearer auth and refuses an unknown custom provider", () => {
    expect(() => saveCustomProvider(config({ auth: "bearer" }))).toThrow("API key");
    expect(() => resolveProviderSelection({ flagProvider: "custom:missing", creds: {} })).toThrow("Unknown provider");
  });

  it("selects configured defaults and free-form models without crossing provider catalogs", () => {
    saveCustomProvider(config());
    expect(resolveProviderSelection({ flagProvider: "custom:gateway", creds: { openaiApiKey: "builtin" }, settings: { defaultProviderId: "anthropic", defaultModel: "claude-opus-5" } }))
      .toEqual({ providerId: "custom:gateway", model: "gpt-4o-mini" });
    expect(resolveProviderSelection({ flagProvider: "custom:gateway", flagModel: "new/model", creds: {} })?.model).toBe("new/model");
    expect(resolveProviderSelection({ creds: {}, settings: { defaultProviderId: "custom:gateway", defaultModel: "removed-model" } })?.model).toBe("gpt-4o-mini");
  });

  it("keeps built-in model collisions intact and refreshes paid custom models and removals", () => {
    const builtin = getModel("gpt-4o-mini", "openai");
    saveCustomProvider(config({ models: [{ id: "gpt-4o-mini", contextWindow: 8192, isFree: false }] }));
    createProviders({});
    expect(getModel("gpt-4o-mini", "openai")).toBe(builtin);
    expect(getModel("gpt-4o-mini", "custom:gateway")?.contextWindow).toBe(8192);
    expect(visibleModels().some(model => model.providerId === "custom:gateway")).toBe(true);
    saveCustomProvider(config({ models: [{ id: "replacement", contextWindow: 4096 }] }));
    createProviders({});
    expect(getModel("gpt-4o-mini", "custom:gateway")).toBeUndefined();
    saveSettings({ defaultProviderId: "custom:gateway", defaultModel: "replacement", theme: "dark" });
    removeCustomProvider("custom:gateway");
    createProviders({});
    expect(getModel("replacement", "custom:gateway")).toBeUndefined();
    expect(loadSettings()).toEqual({ theme: "dark" });
    expect(loadCustomProviders()).toEqual([]);
    expect(JSON.parse(fs.readFileSync(path.join(root, "provider-keys.json"), "utf8"))).toEqual({});
  });

  it("rolls back an existing key if updating its configuration fails", () => {
    saveCustomProvider(config({ auth: "bearer" }), "original-key");
    const rename = fs.renameSync;
    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      if (to === path.join(root, "providers.json")) throw new Error("config fixture unavailable");
      rename(from, to);
    });
    expect(() => saveCustomProvider(config({ auth: "bearer", name: "Changed" }), "new-key")).toThrow("unavailable");
    expect(JSON.parse(fs.readFileSync(path.join(root, "provider-keys.json"), "utf8"))["custom:gateway"]).toBe("original-key");
    expect(loadCustomProviders()[0].name).toBe("My Gateway");
  });

  it("round-trips the custom provider identity and model context in saved sessions", () => {
    saveCustomProvider(config());
    const provider = createProviders({})["custom:gateway"];
    const options = { systemPrompt: "fixture", model: "gpt-4o-mini", maxTokens: 100, projectRoot: root, permissionBroker: { async requestPermission() { return false; } } };
    const first = new AgentSession(provider, options);
    const stored = first.toStoredSession(provider.id, options.model);
    saveSession(stored);
    const restored = loadSession(stored.metadata.id)!;
    expect(restored.metadata.providerId).toBe("custom:gateway");
    expect(new AgentSession(provider, options, restored).contextWindow).toBe(8192);
  });

  it.each([
    { id: "openai" }, { id: "custom:../bad" }, { baseUrl: "file:///tmp/key" },
    { baseUrl: "https://name:secret@fixture.invalid/v1" }, { baseUrl: "https://fixture.invalid/v1?key=secret" },
    { headers: { Authorization: "Bearer secret" } }, { headers: { "X-Test": "bad\r\nheader" } },
    { headers: { "X-Api-Key": "secret" } }, { headers: { Foo: "one", foo: "two" } },
    { apiKeyEnv: "INVALID ENV" }, { models: [] }, { models: [{ id: "m", contextWindow: 0 }] },
    { models: [{ id: "m", contextWindow: 10 }, { id: "m", contextWindow: 20 }] },
    { apiKey: "must-not-be-here" }, { streamUsage: "yes" },
  ])("rejects invalid configuration without echoing its values: %j", extra => {
    expect(() => validateCustomProvider({ ...config(), ...extra })).toThrow("Invalid custom provider");
  });

  it("reports corrupt JSON without exposing file contents", () => {
    fs.writeFileSync(path.join(root, "providers.json"), '{"secret":"do-not-echo-me",');
    expect(() => loadCustomProviders()).toThrow("Invalid JSON in providers.json");
    try { loadCustomProviders(); } catch (err) { expect(String(err)).not.toContain("do-not-echo-me"); }
  });
});

async function server(handler: (req: IncomingMessage, res: ServerResponse, body: Record<string, unknown>) => void) {
  const instance = createServer(async (req, res) => {
    let data = "";
    for await (const chunk of req) data += chunk;
    handler(req, res, JSON.parse(data || "{}"));
  });
  await new Promise<void>(resolve => instance.listen(0, "127.0.0.1", resolve));
  const address = instance.address();
  if (!address || typeof address === "string") throw new Error("fixture server unavailable");
  closes.push(() => new Promise(resolve => { instance.closeAllConnections(); instance.close(() => resolve()); }));
  return `http://127.0.0.1:${address.port}/v1`;
}
function sse(res: ServerResponse, chunks: unknown[]) {
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  res.end(chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n");
}
const request = (signal?: AbortSignal): CompletionRequest => ({
  model: "gpt-4o-mini", systemPrompt: "fixture", maxTokens: 100,
  messages: [{ role: "user", content: [{ type: "text", text: "hello" }, { type: "image", mediaType: "image/png", data: "fixture" }] }],
  tools: [{ name: "fixture", description: "fixture", inputSchema: { type: "object" }, mutating: false }], signal,
});

describe("custom provider HTTP integration", () => {
  it("streams tools and usage with its own credentials, URL and request options", async () => {
    let captured: Record<string, unknown> = {};
    const baseUrl = await server((req, res, body) => {
      captured = { headers: req.headers, url: req.url, body };
      sse(res, [
        { choices: [{ delta: { tool_calls: [{ index: 0, id: "call1", function: { name: "fixture", arguments: '{"x":1}' } }] }, finish_reason: "tool_calls" }] },
        { choices: [], usage: { prompt_tokens: 15, completion_tokens: 4 } },
      ]);
    });
    vi.stubEnv("OPENAI_BASE_URL", "https://wrong.invalid");
    vi.stubEnv("OPENAI_ORG_ID", "unrelated-org");
    vi.stubEnv("OPENAI_PROJECT_ID", "unrelated-project");
    vi.stubEnv("OPENAI_ADMIN_KEY", "unrelated-admin-key");
    saveCustomProvider(config({ baseUrl, auth: "bearer", headers: { "X-Client": "anvil-test" } }), "endpoint-key");
    const events: StreamEvent[] = [];
    for await (const event of createProviders({})["custom:gateway"].streamCompletion(request())) events.push(event);
    expect(captured.url).toBe("/v1/chat/completions");
    expect(captured.headers).toMatchObject({ authorization: "Bearer endpoint-key", "x-client": "anvil-test" });
    expect(captured.headers).not.toHaveProperty("openai-organization");
    expect(captured.headers).not.toHaveProperty("openai-project");
    expect(captured.body).toMatchObject({ max_tokens: 100, stream: true, stream_options: { include_usage: true } });
    expect(JSON.stringify(captured.body)).not.toContain("image_url");
    expect(events).toContainEqual({ type: "tool_call_end", id: "call1", name: "fixture", input: { x: 1 } });
    expect(events).toContainEqual({ type: "usage", inputTokens: 15, outputTokens: 4 });
  });

  it("omits bearer auth and unsupported fields while supporting custom header auth and vision", async () => {
    let captured: Record<string, unknown> = {};
    const baseUrl = await server((req, res, body) => {
      captured = { headers: req.headers, body };
      sse(res, [{ choices: [{ delta: { content: "hello" }, finish_reason: "stop" }] }]);
    });
    vi.stubEnv("CUSTOM_HEADER_KEY", "header-only-key");
    vi.stubEnv("OPENAI_API_KEY", "unrelated-openai-key");
    saveCustomProvider(config({ baseUrl, headers: { "X-Api-Key": "$CUSTOM_HEADER_KEY" },
      streamUsage: false, maxTokensParam: "max_completion_tokens",
      models: [{ id: "gpt-4o-mini", contextWindow: 8192, supportsTools: false, supportsVision: true }],
    }));
    for await (const _ of createProviders({})["custom:gateway"].streamCompletion(request())) { /* consume the stream */ }
    expect(captured.headers).not.toHaveProperty("authorization");
    expect(captured.headers).toMatchObject({ "x-api-key": "header-only-key" });
    expect(captured.body).toHaveProperty("max_completion_tokens", 100);
    for (const field of ["tools", "max_tokens", "stream_options"]) expect(captured.body).not.toHaveProperty(field);
    expect(JSON.stringify(captured.body)).toContain("image_url");
  });

  it("redacts authentication secrets echoed in an API error", async () => {
    const baseUrl = await server((_req, res) => {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Bad endpoint-key with header-secret" } }));
    });
    vi.stubEnv("CUSTOM_HEADER_KEY", "header-secret");
    saveCustomProvider(config({ baseUrl, auth: "bearer", headers: { "X-Api-Key": "$CUSTOM_HEADER_KEY" } }), "endpoint-key");
    const events = [];
    for await (const event of createProviders({})["custom:gateway"].streamCompletion(request())) events.push(event);
    expect(events.some(event => event.type === "error")).toBe(true);
    expect(JSON.stringify(events)).not.toContain("endpoint-key");
    expect(JSON.stringify(events)).not.toContain("header-secret");
    expect(JSON.stringify(events)).toContain("[redacted]");
  });

  it("refuses redirects rather than forwarding endpoint credentials", async () => {
    let forwarded = false;
    const target = await server((_req, res) => { forwarded = true; res.end(); });
    const baseUrl = await server((_req, res) => { res.writeHead(307, { Location: target }); res.end(); });
    saveCustomProvider(config({ baseUrl, auth: "bearer" }), "endpoint-key");
    const events = [];
    for await (const event of createProviders({})["custom:gateway"].streamCompletion(request())) events.push(event);
    expect(forwarded).toBe(false);
    expect(events.some(event => event.type === "error")).toBe(true);
  });

  it("cancels an in-flight HTTP stream", async () => {
    let closed!: () => void;
    const disconnected = new Promise<void>(resolve => { closed = resolve; });
    const baseUrl = await server((_req, res) => {
      res.once("close", closed);
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write('data: {"choices":[{"delta":{"content":"started"}}]}\n\n');
    });
    saveCustomProvider(config({ baseUrl }));
    const provider = createProviders({})["custom:gateway"];
    const session = new AgentSession(provider, { model: "gpt-4o-mini", systemPrompt: "fixture", maxTokens: 100, projectRoot: root,
      permissionBroker: { async requestPermission() { return false; } } });
    const events = [];
    for await (const event of session.send("hello")) {
      events.push(event);
      if (event.type === "text_delta") session.cancel();
    }
    await disconnected;
    expect(events[0]).toEqual({ type: "text_delta", text: "started" });
    expect(events.filter(event => event.type === "cancelled")).toHaveLength(1);
    expect(events.some(event => event.type === "error")).toBe(false);
  });

  it("supports multi-wire protocols (openai-responses, anthropic) and optional models", () => {
    const responsesConfig = validateCustomProvider({
      id: "custom:responses-gw",
      name: "Responses Gateway",
      baseUrl: "https://fixture.invalid/v1",
      auth: "none",
      protocol: "openai-responses",
    });
    expect(responsesConfig.protocol).toBe("openai-responses");
    expect(responsesConfig.models).toBeUndefined();

    const models = customProviderModels([responsesConfig]);
    expect(models).toHaveLength(1);
    expect(models[0].id).toBe("default");
    expect(models[0].contextWindow).toBe(128_000);

    const anthropicConfig = validateCustomProvider({
      id: "custom:anthropic-gw",
      name: "Anthropic Gateway",
      baseUrl: "https://fixture.invalid",
      auth: "bearer",
      protocol: "anthropic",
      models: [{ id: "claude-3-5-sonnet", contextWindow: 200_000 }],
    });
    expect(anthropicConfig.protocol).toBe("anthropic");

    expect(() =>
      validateCustomProvider({
        id: "custom:bad",
        name: "Bad",
        baseUrl: "https://fixture.invalid",
        auth: "none",
        protocol: "invalid-proto" as any,
      })
    ).toThrow("Invalid custom provider protocol");
  });

  it("fetches and tests dynamic models via /models", async () => {
    const baseUrl = await server((req, res) => {
      expect(req.url).toBe("/v1/models");
      expect(req.headers.authorization).toBe("Bearer test-token");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        data: [
          { id: "llama-3.3-70b", context_length: 131072 },
          { id: "deepseek-r1", context_length: 65536 },
        ],
      }));
    });

    const cfg: CustomProviderConfig = {
      id: "custom:dynamic",
      name: "Dynamic",
      baseUrl,
      auth: "bearer",
    };

    const models = await fetchCustomProviderModels(cfg, "test-token");
    expect(models).toHaveLength(2);
    expect(models[0].id).toBe("llama-3.3-70b");
    expect(models[0].contextWindow).toBe(131072);
    expect(models[1].id).toBe("deepseek-r1");

    const testRes = await testCustomProvider(cfg, "test-token");
    expect(testRes.ok).toBe(true);
    expect(testRes.modelsCount).toBe(2);
    expect(testRes.models).toContain("llama-3.3-70b");
  });
});

