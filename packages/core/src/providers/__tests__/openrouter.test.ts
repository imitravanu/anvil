import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createOpenRouterProvider,
  getModelsForProvider,
  MODEL_REGISTRY,
  registerModel,
  registerModels,
  syncOpenRouterModels,
  unregisterModels,
} from "../index.js";
import { resolveProviderSelection } from "../../config/index.js";
import type { ModelInfo } from "../types.js";

describe("OpenRouter Registry and Free Models", () => {
  let registrySnapshot: ModelInfo[] = [];
  let tmp = "";
  let savedHome: string | undefined;
  beforeEach(() => {
    // The sync under test merges into the GLOBAL registry — snapshot it so
    // demotion/promotion side effects never leak into other suites.
    registrySnapshot = structuredClone(MODEL_REGISTRY);
    // …and writes the models cache — keep that in a temp dir as well.
    savedHome = process.env.ANVIL_HOME;
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-or-"));
    process.env.ANVIL_HOME = tmp;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    MODEL_REGISTRY.length = 0;
    MODEL_REGISTRY.push(...registrySnapshot);
    if (savedHome === undefined) delete process.env.ANVIL_HOME;
    else process.env.ANVIL_HOME = savedHome;
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    tmp = "";
  });
  it("registers openrouter models with free models prioritized first", () => {
    const openrouterModels = getModelsForProvider("openrouter");
    expect(openrouterModels.length).toBeGreaterThan(1);

    // The first model should be a free model
    expect(openrouterModels[0].id).toBe("openrouter/free");
    expect(openrouterModels[0].isFree).toBe(true);

    // DeepSeek paid model should be present and marked paid
    const deepseek = openrouterModels.find((m) => m.id === "deepseek/deepseek-v3.2");
    expect(deepseek).toBeDefined();
    expect(deepseek?.isFree).toBe(false);
  });

  it("defaults to openrouter/free when openrouter is the only configured provider", () => {
    const sel = resolveProviderSelection({
      creds: { openrouterApiKey: "or-key" },
    });
    expect(sel).toEqual({
      providerId: "openrouter",
      model: "openrouter/free",
    });
  });

  it("registers new dynamic models via registerModel and registerModels", () => {
    const testModel = {
      id: "test-vendor/test-model:free",
      providerId: "openrouter",
      displayName: "Test Model (Free)",
      contextWindow: 128_000,
      supportsTools: true,
      supportsVision: false,
      isFree: true,
    };

    registerModel(testModel);
    expect(MODEL_REGISTRY.some((m) => m.id === "test-vendor/test-model:free")).toBe(true);

    // Re-registering updates the model without duplicates
    registerModels([{ ...testModel, displayName: "Updated Test Model (Free)" }]);
    const matches = MODEL_REGISTRY.filter((m) => m.id === "test-vendor/test-model:free");
    expect(matches.length).toBe(1);
    expect(matches[0].displayName).toBe("Updated Test Model (Free)");
  });

  it("creates an openrouter provider instance", () => {
    const provider = createOpenRouterProvider("sk-or-test");
    expect(provider.id).toBe("openrouter");
    expect(provider.isConfigured()).toBe(true);

    const unconfigured = createOpenRouterProvider(undefined);
    expect(unconfigured.isConfigured()).toBe(false);
  });

  it("syncOpenRouterModels handles live sync and returns SyncResult", async () => {
    // Mocked network: the old version did a real fetch whose assertions
    // passed on failure too (and mutated the global registry on success).
    // The mock mirrors the CURRENT free set (no spurious demotions) plus one
    // brand-new free model.
    const currentFree = getModelsForProvider("openrouter")
      .filter((m) => m.isFree)
      .map((m) => ({
        id: m.id,
        name: m.displayName,
        pricing: { prompt: "0", completion: "0" },
        supported_parameters: ["tools"],
        architecture: { modality: "text" },
        context_length: 64000,
      }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          data: [
            ...currentFree,
            {
              id: "mock/mock-free:free",
              name: "Mock Free",
              pricing: { prompt: "0", completion: "0" },
              supported_parameters: ["tools"],
              architecture: { modality: "text" },
              context_length: 64000,
            },
          ],
        }),
      }))
    );
    const res = await syncOpenRouterModels("dummy-key");
    expect(res.freeCount).toBeGreaterThanOrEqual(1);
    expect(res.newlyFree).toContain("mock/mock-free:free");
    expect(res.noLongerFree).toEqual([]);
    expect(typeof res.freeCount).toBe("number");
  });

  it("syncOpenRouterModels reports fetch failures instead of throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      })
    );
    const res = await syncOpenRouterModels("dummy-key");
    expect(res.freeCount).toBe(0);
  });
});
