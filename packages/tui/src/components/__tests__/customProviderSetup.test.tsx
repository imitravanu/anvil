import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createProviders, loadCustomProviders, saveCustomProvider, type CustomProviderConfig } from "@anvil/core";
import { FirstRunSetup } from "../FirstRunSetup.js";
import { CustomProviderSetup } from "../CustomProviderSetup.js";
import { ModelPicker } from "../ModelPicker.js";
import { PROVIDER_META } from "../../util/providers.js";
import { renderThemed, frameText, tick, type ThemedRender } from "../../test-utils/testRender.js";

let root: string;
const apps: ThemedRender[] = [];
const config: CustomProviderConfig = { id: "custom:fixture", name: "Fixture Gateway", baseUrl: "https://fixture.invalid/v1", auth: "bearer",
  models: [{ id: "fixture-model", contextWindow: 8192, isFree: false }] };
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-custom-ui-"));
  vi.stubEnv("ANVIL_HOME", root);
});
afterEach(() => {
  apps.splice(0).forEach(app => app.unmount());
  createProviders({}, []);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});
function mount(component: React.ReactElement) {
  const app = renderThemed(component); apps.push(app); return app;
}
async function press(app: ThemedRender, key = "\r") { app.stdin.write(key); await tick(40); }
async function fill(app: ThemedRender, value: string) { await press(app, value); await press(app); }
async function reviewExisting(app: ThemedRender) {
  await tick();
  // Display name, URL, retained key, models, context and optional JSON.
  for (let i = 0; i < 6; i++) await press(app);
  expect(frameText(app.lastFrame)).toContain("review");
}

describe("custom provider setup", () => {
  it("adds a provider through /connect, hides the key, and persists usable settings", async () => {
    const done = vi.fn();
    const app = mount(<FirstRunSetup onDone={done} />);
    await tick();
    for (let i = 0; i < PROVIDER_META.length; i++) await press(app, "\u001b[B");
    expect(frameText(app.lastFrame)).toContain("Add custom OpenAI-compatible provider");
    await press(app);
    await fill(app, "fixture");
    await fill(app, "Fixture Gateway");
    await fill(app, "https://fixture.invalid/v1");
    await press(app, "ui-secret-key");
    expect(frameText(app.lastFrame)).not.toContain("ui-secret-key");
    await press(app);
    await fill(app, "fixture-model, second-model");
    await press(app); // conservative context default
    await press(app); // default compatibility options
    expect(frameText(app.lastFrame)).toContain("stored key (hidden)");
    expect(fs.existsSync(path.join(root, "providers.json"))).toBe(false);
    await press(app); // review/save
    expect(done).toHaveBeenCalledWith("custom:fixture");
    expect(loadCustomProviders()[0].models!.map(model => model.id)).toEqual(["fixture-model", "second-model"]);
    expect(createProviders({})["custom:fixture"].isConfigured()).toBe(true);
    expect(fs.readFileSync(path.join(root, "providers.json"), "utf8")).not.toContain("ui-secret-key");
  });

  it("keeps an existing key when editing without typing a replacement", async () => {
    saveCustomProvider(config, "retained-key");
    const done = vi.fn();
    const app = mount(<CustomProviderSetup initial={config} onDone={done} onRemoved={vi.fn()} onCancel={vi.fn()} />);
    await reviewExisting(app);
    expect(frameText(app.lastFrame)).not.toContain("retained-key");
    await press(app);
    expect(done).toHaveBeenCalledWith(config.id);
    expect(JSON.parse(fs.readFileSync(path.join(root, "provider-keys.json"), "utf8"))[config.id]).toBe("retained-key");
  });

  it("requires explicit confirmation before removing a saved provider", async () => {
    saveCustomProvider(config, "remove-key");
    const removed = vi.fn();
    const app = mount(<CustomProviderSetup initial={config} onDone={vi.fn()} onRemoved={removed} onCancel={vi.fn()} />);
    await reviewExisting(app);
    await press(app, "d");
    expect(loadCustomProviders()).toHaveLength(1);
    await fill(app, config.id);
    expect(removed).toHaveBeenCalledOnce();
    expect(loadCustomProviders()).toEqual([]);
  });

  it("does not offer deletion of the active provider", async () => {
    saveCustomProvider(config, "active-key");
    const app = mount(<CustomProviderSetup initial={config} activeProviderId={config.id} onDone={vi.fn()} onRemoved={vi.fn()} onCancel={vi.fn()} />);
    await reviewExisting(app);
    expect(frameText(app.lastFrame)).toContain("Switch to another provider");
    await press(app, "d");
    expect(frameText(app.lastFrame)).not.toContain("confirm removal");
    expect(loadCustomProviders()).toHaveLength(1);
  });

  it("returns through the fields and cancels without writing partial configuration", async () => {
    const cancel = vi.fn();
    const app = mount(<CustomProviderSetup onDone={vi.fn()} onRemoved={vi.fn()} onCancel={cancel} />);
    await tick();
    await fill(app, "unfinished");
    await press(app, "\u001b");
    expect(frameText(app.lastFrame)).toContain("Provider ID");
    await press(app, "\u001b");
    expect(cancel).toHaveBeenCalledOnce();
    expect(fs.existsSync(path.join(root, "providers.json"))).toBe(false);
  });

  it("shows and selects an explicitly configured paid custom model", async () => {
    saveCustomProvider(config, "picker-key");
    const providers = createProviders({});
    const select = vi.fn();
    const app = mount(<ModelPicker providers={providers} currentModelId="" onSelect={select} onClose={vi.fn()} />);
    await tick();
    await press(app, "custom:fixture");
    expect(frameText(app.lastFrame)).toContain("Fixture Gateway");
    await press(app);
    expect(select).toHaveBeenCalledWith(providers[config.id], expect.objectContaining({ id: "fixture-model", providerId: config.id }));
  });

  it("disables only the model whose header credential is missing", async () => {
    vi.stubEnv("ANVIL_TEST_PICKER_KEY", "");
    saveCustomProvider({ ...config, models: [
      { id: "blocked-route", contextWindow: 8192, headers: { "X-Api-Key": "$ANVIL_TEST_PICKER_KEY" } },
      { id: "ready-route", contextWindow: 8192 },
    ] }, "picker-key");
    const providers = createProviders({});
    const select = vi.fn();
    const blocked = mount(<ModelPicker providers={providers} currentModelId="" onSelect={select} onClose={vi.fn()} />);
    await tick();
    await press(blocked, "blocked-route");
    await press(blocked);
    expect(select).not.toHaveBeenCalled();
    blocked.unmount();
    const ready = mount(<ModelPicker providers={providers} currentModelId="" onSelect={select} onClose={vi.fn()} />);
    await tick();
    await press(ready, "ready-route");
    await press(ready);
    expect(select).toHaveBeenCalledWith(providers[config.id], expect.objectContaining({ id: "ready-route" }));
  });

  it("preserves protocol and per-model routing overrides through an ordinary edit", async () => {
    const routed: CustomProviderConfig = { ...config, protocol: "anthropic", models: [{ id: "fixture-model", contextWindow: 8192, protocol: "openai-responses", baseUrl: "https://responses.invalid/v1", headers: { "X-Client": "model" } }] };
    saveCustomProvider(routed, "retained-key");
    const app = mount(<CustomProviderSetup initial={routed} onDone={vi.fn()} onRemoved={vi.fn()} onCancel={vi.fn()} />);
    await reviewExisting(app);
    expect(frameText(app.lastFrame)).toContain("Protocol: anthropic");
    await press(app);
    expect(loadCustomProviders()[0]).toMatchObject(routed);
  });

  it("accepts blank models and discovers selectable rows when opening the picker", async () => {
    const dynamic = { ...config, auth: "none" as const, models: [] };
    saveCustomProvider(dynamic);
    const app = mount(<CustomProviderSetup initial={dynamic} onDone={vi.fn()} onRemoved={vi.fn()} onCancel={vi.fn()} />);
    await reviewExisting(app);
    expect(frameText(app.lastFrame)).toContain("dynamic / auto-discover");
    await press(app);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response('{"data":[{"id":"live-picker-model","context_length":16384}]}'));
    const providers = createProviders({});
    const select = vi.fn();
    const picker = mount(<ModelPicker providers={providers} currentModelId="" onSelect={select} onClose={vi.fn()} />);
    await tick(100);
    await press(picker, "live-picker-model");
    expect(frameText(picker.lastFrame)).toContain("live-picker-model");
    await press(picker);
    expect(select).toHaveBeenCalledWith(providers[config.id], expect.objectContaining({ id: "live-picker-model", providerId: config.id }));
  });
});
