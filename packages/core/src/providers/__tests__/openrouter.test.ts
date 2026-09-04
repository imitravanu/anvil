import { describe, expect, it } from "vitest";
import {
  createOpenRouterProvider,
  getModelsForProvider,
  MODEL_REGISTRY,
  registerModel,
  registerModels,
  syncOpenRouterModels,
} from "../index.js";
import { resolveProviderSelection } from "../../config/index.js";

describe("OpenRouter Registry and Free Models", () => {
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
    const res = await syncOpenRouterModels("dummy-key");
    expect(res).toHaveProperty("freeCount");
    expect(res).toHaveProperty("newlyFree");
    expect(res).toHaveProperty("noLongerFree");
    expect(typeof res.freeCount).toBe("number");
  });
});
