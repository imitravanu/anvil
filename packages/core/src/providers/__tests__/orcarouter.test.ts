import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  MODEL_REGISTRY,
  ORCAROUTER_BASE_URL,
  createOrcarouterProvider,
  createOrcarouterFreeSource,
  createOpenRouterFreeSource,
  fetchOrcarouterFreeModels,
  getModelsForProvider,
  isFreeModelId,
  isRateLimitMessage,
  registerModel,
  syncFreeModels,
  visibleModels,
} from "../index.js";
import { resolveProviderSelection } from "../../config/index.js";
import type { ModelInfo } from "../types.js";

/** Live-shaped /models payload (2026-09): no pricing metadata, free signaled by id only. */
const LIVE_SHAPE_DATA = [
  { id: "orcarouter/free", object: "model", created: 0, owned_by: "orcarouter" },
  { id: "orcarouter/fusion", object: "model", created: 0, owned_by: "orcarouter" },
  { id: "orcarouter/fusion-flash", object: "model", created: 0, owned_by: "orcarouter" },
  { id: "orcarouter/fusion-mini", object: "model", created: 0, owned_by: "orcarouter" },
  { id: "orcarouter/auto", object: "model", created: 0, owned_by: "orcarouter" },
  { id: "qwen/qwen3.8-27b-free", object: "model", created: 0, owned_by: "qwen" },
];

describe("Orcarouter free-model gate", () => {
  it("classifies ids exactly like the live API signals them", () => {
    expect(isFreeModelId("orcarouter/free")).toBe(true);
    expect(isFreeModelId("qwen/qwen3.8-27b-free")).toBe(true);
    expect(isFreeModelId("deepseek/deepseek-v4-flash-free")).toBe(true);
    // Paid family must never pass — this is the whole free-only policy.
    expect(isFreeModelId("orcarouter/fusion")).toBe(false);
    expect(isFreeModelId("orcarouter/fusion-flash")).toBe(false);
    expect(isFreeModelId("orcarouter/fusion-mini")).toBe(false);
    expect(isFreeModelId("orcarouter/auto")).toBe(false);
    // ":free" (OpenRouter style) is NOT orcarouter's signal.
    expect(isFreeModelId("vendor/model:free")).toBe(false);
  });

  it("treats orcarouter capacity errors as retryable rate-limit class", () => {
    // Live 2026-09: free models return "503 No available capacity … try again later".
    expect(isRateLimitMessage("503 No available capacity for model qwen/qwen3.8-27b-free right now. Please try again later.")).toBe(true);
    expect(isRateLimitMessage("429 Too Many Requests")).toBe(true);
    expect(isRateLimitMessage("invalid api key")).toBe(false);
  });

  it("fetchOrcarouterFreeModels drops paid models at the source", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ data: LIVE_SHAPE_DATA }) }))
    );
    const models = await fetchOrcarouterFreeModels();
    const ids = models.map((m) => m.id);
    expect(ids).toContain("orcarouter/free");
    expect(ids).toContain("qwen/qwen3.8-27b-free");
    // Paid models never leave the source.
    expect(ids).not.toContain("orcarouter/fusion");
    expect(ids).not.toContain("orcarouter/fusion-flash");
    expect(ids).not.toContain("orcarouter/auto");
    // Auto-router alias sorts first (openrouter/free convention).
    expect(models[0].id).toBe("orcarouter/free");
    // Everything that passed the gate is marked free.
    for (const m of models) expect(m.isFree).toBe(true);
    // Pretty names: vendor split + "-free" suffix stripped + "(Free)" appended.
    const qwen = models.find((m) => m.id === "qwen/qwen3.8-27b-free");
    expect(qwen?.displayName).toBe("Qwen: Qwen3.8 27B (Free)");
  });

  it("sends the Authorization header only when a key is given", async () => {
    const fetchMock = vi.fn(
      async (_url: string | URL, _init?: RequestInit) => ({ ok: true, json: async () => ({ data: [] }) })
    );
    vi.stubGlobal("fetch", fetchMock);
    await fetchOrcarouterFreeModels("orca-key");
    expect(fetchMock.mock.calls[0][0]).toBe(`${ORCAROUTER_BASE_URL}/models`);
    expect(fetchMock.mock.calls[0][1]?.headers).toEqual({
      Authorization: "Bearer orca-key",
    });
    await fetchOrcarouterFreeModels(undefined);
    expect(fetchMock.mock.calls[1][1]?.headers).toEqual({});
  });

  it("reports HTTP and shape failures instead of throwing garbage", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 502, statusText: "Bad Gateway" }))
    );
    await expect(fetchOrcarouterFreeModels()).rejects.toThrow(/HTTP 502/);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ unexpected: true }) }))
    );
    await expect(fetchOrcarouterFreeModels()).rejects.toThrow(/missing data array/);
  });
});

describe("Orcarouter provider + registry", () => {
  it("creates a provider wired to the orcarouter gateway", () => {
    const provider = createOrcarouterProvider("orca-key");
    expect(provider.id).toBe("orcarouter");
    expect(provider.displayName).toBe("Orcarouter");
    expect(provider.isConfigured()).toBe(true);
    expect(createOrcarouterProvider(undefined).isConfigured()).toBe(false);
  });

  it("registers static free models and no paid ones", () => {
    const models = getModelsForProvider("orcarouter");
    expect(models.length).toBeGreaterThan(0);
    for (const m of models) expect(m.isFree).toBe(true);
    expect(models.some((m) => m.id === "orcarouter/free")).toBe(true);
  });

  it("visibleModels() hides paid entries from picker-style views", () => {
    const paid = MODEL_REGISTRY.find((m) => m.isFree === false);
    expect(paid).toBeDefined(); // the deepseek paid entry ships for lookups
    const visible = visibleModels();
    expect(visible.some((m) => m.id === paid!.id)).toBe(false);
    expect(visible.some((m) => m.id === "orcarouter/free")).toBe(true);
    expect(visible.length).toBe(MODEL_REGISTRY.length - 1);
  });

  it("resolves orcarouter/free as the provider default", () => {
    const sel = resolveProviderSelection({ creds: { orcarouterApiKey: "orca-key" } });
    expect(sel).toEqual({ providerId: "orcarouter", model: "orcarouter/free" });
  });
});

describe("Orcarouter + OpenRouter dual-source auto-sync", () => {
  let registrySnapshot: ModelInfo[] = [];
  let tmp = "";
  let savedHome: string | undefined;
  beforeEach(() => {
    // The sync merges into the GLOBAL registry — snapshot + isolate like the
    // openrouter suite so demotion/registration side effects never leak.
    registrySnapshot = structuredClone(MODEL_REGISTRY);
    savedHome = process.env.ANVIL_HOME;
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-orca-"));
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

  it("syncFreeModels merges both routers; paid models never register", async () => {
    // Route the mocked network by URL, exactly as the coordinator sees it.
    const openrouterFree = getModelsForProvider("openrouter")
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
      vi.fn(async (url: string) => {
        if (String(url).startsWith("https://api.orcarouter.ai/")) {
          return {
            ok: true,
            json: async () => ({
              data: [
                ...LIVE_SHAPE_DATA,
                // brand-new free model (churn simulation) + a paid one that must be dropped
                { id: "vendor/brand-new-free", object: "model", created: 0, owned_by: "vendor" },
                { id: "orcarouter/fusion-ultra", object: "model", created: 0, owned_by: "orcarouter" },
              ],
            }),
          };
        }
        return { ok: true, json: async () => ({ data: openrouterFree }) };
      })
    );

    const report = await syncFreeModels({
      sources: [createOpenRouterFreeSource(), createOrcarouterFreeSource()],
      ttlMs: 0,
    });

    const bySource = new Map(report.results.map((r) => [r.sourceId, r]));
    expect(bySource.get("openrouter")?.ok).toBe(true);
    const orca = bySource.get("orcarouter");
    expect(orca?.ok).toBe(true);
    // Only free ids counted; the fusion-ultra paid id never entered.
    expect(orca?.count).toBe(3); // alias + qwen + brand-new
    expect(orca?.newlyFree).toContain("vendor/brand-new-free");
    expect(MODEL_REGISTRY.some((m) => m.id === "vendor/brand-new-free")).toBe(true);
    expect(MODEL_REGISTRY.some((m) => m.id === "orcarouter/fusion-ultra")).toBe(false);
    expect(MODEL_REGISTRY.some((m) => m.id === "orcarouter/fusion")).toBe(false);
    expect(report.refreshedAt).not.toBeNull();
  });

  it("keeps the registry intact when one source fails mid-sync", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).startsWith("https://api.orcarouter.ai/")) {
          throw new Error("orcarouter down");
        }
        return { ok: true, json: async () => ({ data: [] }) };
      })
    );
    const report = await syncFreeModels({
      sources: [createOpenRouterFreeSource(), createOrcarouterFreeSource()],
      ttlMs: 0,
    });
    const orca = report.results.find((r) => r.sourceId === "orcarouter");
    expect(orca?.ok).toBe(false);
    expect(orca?.error).toMatch(/orcarouter down/);
    // An empty/failed source must not demote the static orcarouter models.
    expect(getModelsForProvider("orcarouter").length).toBeGreaterThan(0);
  });

  it("registerModel keeps orcarouter entries deduplicated", () => {
    registerModel({
      id: "qwen/qwen3.8-27b-free",
      providerId: "orcarouter",
      displayName: "Qwen: Qwen3.8 27B (Free)",
      contextWindow: 131_072, // e.g. context window learned from live data
      supportsTools: true,
      supportsVision: false,
      isFree: true,
    });
    const matches = MODEL_REGISTRY.filter((m) => m.id === "qwen/qwen3.8-27b-free");
    expect(matches.length).toBe(1);
    expect(matches[0].contextWindow).toBe(131_072);
  });
});
