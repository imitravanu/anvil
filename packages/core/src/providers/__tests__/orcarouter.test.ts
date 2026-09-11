import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  MODEL_REGISTRY,
  ORCAROUTER_PRICING_URL,
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

/** Live-shaped pricing-catalog payload (2026-09-09): is_free_tier flag is the
 * single authority; model_ratio 0 alone is NOT free (image endpoints ride at 0). */
const LIVE_PRICING_SHAPE_DATA = [
  {
    model_name: "deepseek/deepseek-v4-flash-free",
    display_name: "DeepSeek: DeepSeek V4 Flash (Free)",
    context_length: 1048576,
    input_modalities: ["text"],
    supported_parameters: ["tools", "temperature", "stream"],
    is_free_tier: true,
    free_base_model: "deepseek/deepseek-v4-flash",
    model_ratio: 0,
  },
  {
    model_name: "z-ai/glm-5.3-flash-free",
    display_name: "Z.ai: GLM 5.3 Flash (Free)",
    context_length: 1000000,
    input_modalities: ["text", "image", "video"],
    supported_parameters: ["tools", "temperature", "stream"],
    is_free_tier: true,
    free_base_model: "z-ai/glm-5.3-flash",
    model_ratio: 0,
  },
  {
    model_name: "tencent/hy3-free",
    display_name: "Tencent: Hy3 (Free)",
    context_length: 262144,
    input_modalities: ["text"],
    supported_parameters: ["tools", "temperature"],
    is_free_tier: true,
    free_base_model: "tencent/hy3",
    model_ratio: 0,
  },
  // Paid: zero model_ratio is NOT the free signal (image endpoint, not free chat).
  {
    model_name: "google/imagen-4.0-generate-001",
    display_name: "Google: Imagen 4.0",
    context_length: 0,
    input_modalities: ["text"],
    supported_parameters: ["temperature"],
    is_free_tier: false,
    model_ratio: 0,
  },
  {
    model_name: "orcarouter/fusion",
    display_name: "Orcarouter Fusion",
    context_length: 128000,
    input_modalities: ["text"],
    supported_parameters: ["tools"],
    model_ratio: 1,
  },
  // Stale-shaped paid entry: "-free" suffix WITHOUT the flag must NOT pass
  // (flag alone decides — the delisted qwen proved id and flag can disagree).
  {
    model_name: "qwen/qwen3.8-27b-free",
    display_name: "Qwen: Qwen3.8 27B",
    context_length: 128000,
    input_modalities: ["text"],
    supported_parameters: ["tools"],
    is_free_tier: false,
    model_ratio: 1,
  },
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

  it("fetchOrcarouterFreeModels reads the pricing flag; ratio-0/suffix alone never pass", async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        seen.push(String(url));
        return { ok: true, json: async () => ({ data: LIVE_PRICING_SHAPE_DATA }) };
      })
    );
    const models = await fetchOrcarouterFreeModels();
    // Key-less public catalog — never the keyed /v1/models listing.
    expect(seen).toEqual([ORCAROUTER_PRICING_URL]);
    const ids = models.map((m) => m.id);
    expect(ids).toContain("orcarouter/free");
    expect(ids).toContain("z-ai/glm-5.3-flash-free");
    expect(ids).toContain("deepseek/deepseek-v4-flash-free");
    expect(ids).toContain("tencent/hy3-free");
    // Paid models never leave the source — including the stale qwen whose
    // "-free" suffix outlived its free flag, and the ratio-0 image endpoint.
    expect(ids).not.toContain("orcarouter/fusion");
    expect(ids).not.toContain("qwen/qwen3.8-27b-free");
    expect(ids).not.toContain("google/imagen-4.0-generate-001");
    // Auto-router alias sorts first (openrouter/free convention).
    expect(models[0].id).toBe("orcarouter/free");
    // Everything that passed the gate is marked free.
    for (const m of models) expect(m.isFree).toBe(true);
    // Live catalog metadata flows through: display names, context windows,
    // tool + vision capability flags.
    const glm = models.find((m) => m.id === "z-ai/glm-5.3-flash-free");
    expect(glm?.displayName).toBe("Z.ai: GLM 5.3 Flash (Free)");
    expect(glm?.contextWindow).toBe(1_000_000);
    expect(glm?.supportsTools).toBe(true);
    expect(glm?.supportsVision).toBe(true); // image+video in, per the catalog
    const deepseek = models.find((m) => m.id === "deepseek/deepseek-v4-flash-free");
    expect(deepseek?.displayName).toBe("DeepSeek: DeepSeek V4 Flash (Free)");
    expect(deepseek?.supportsVision).toBe(false); // text-only
  });

  it("throws (no silent empty list) when the catalog flags zero free models", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ data: [{ model_name: "paid/x", is_free_tier: false }] }) }))
    );
    await expect(fetchOrcarouterFreeModels()).rejects.toThrow(/zero free-tier/);
  });

  it("throws a clear error when the pricing catalog is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500, statusText: "Internal Server Error" }))
    );
    await expect(fetchOrcarouterFreeModels()).rejects.toThrow(/pricing catalog returned HTTP 500/);
  });
  it("free discovery needs no key — the public catalog is key-less", async () => {
    const fetchMock = vi.fn(
      async (_url: string | URL, _init?: RequestInit) => ({ ok: true, json: async () => ({ data: [] }) })
    );
    vi.stubGlobal("fetch", fetchMock);
    // Even WITH a key on hand, nothing secret is sent — this is a public
    // endpoint; an Authorization header would leak the key to logs for nothing.
    await expect(fetchOrcarouterFreeModels("orca-key")).rejects.toThrow(/zero free-tier/);
    expect(fetchMock.mock.calls[0][0]).toBe(ORCAROUTER_PRICING_URL);
    expect(fetchMock.mock.calls[0][1]).toEqual({ signal: expect.anything() });
  });

  it("maps catalog capability flags honestly (no tools ⇒ supportsTools false)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          data: [
            {
              model_name: "vendor/no-tools-free",
              display_name: "Vendor: No Tools (Free)",
              context_length: 32000,
              input_modalities: ["text"],
              supported_parameters: ["temperature"],
              is_free_tier: true,
            },
          ],
        }),
      }))
    );
    const models = await fetchOrcarouterFreeModels();
    const m = models.find((x) => x.id === "vendor/no-tools-free");
    expect(m?.supportsTools).toBe(false);
    expect(m?.supportsVision).toBe(false);
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
    // Live lineup 2026-09-09 (official tweet + pricing catalog): GLM replaced qwen.
    expect(models.some((m) => m.id === "z-ai/glm-5.3-flash-free")).toBe(true);
    expect(models.some((m) => m.id === "deepseek/deepseek-v4-flash-free")).toBe(true);
    expect(models.some((m) => m.id === "tencent/hy3-free")).toBe(true);
  });

  it("visibleModels() hides paid entries from picker-style views", () => {
    const paid = MODEL_REGISTRY.filter((m) => m.isFree === false);
    expect(paid.length).toBeGreaterThan(0); // paid entries ship for lookups
    const visible = visibleModels();
    for (const p of paid) expect(visible.some((m) => m.id === p.id && m.providerId === p.providerId)).toBe(false);
    expect(visible.some((m) => m.id === "orcarouter/free")).toBe(true);
    expect(visible.length).toBe(MODEL_REGISTRY.length - paid.length);
  });

  // Live 2026-09: scoped keys 403 on the `orcarouter/free` alias but can call
  // concrete `-free` ids — so a concrete model must be the registry default.
  // (Qwen retired 2026-09-09; GLM 5.3 Flash is the free-tier replacement.)
  it("resolves the concrete free model (not the scoped-403 alias) as the provider default", () => {
    const sel = resolveProviderSelection({ creds: { orcarouterApiKey: "orca-key" } });
    expect(sel).toEqual({ providerId: "orcarouter", model: "z-ai/glm-5.3-flash-free" });
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
    const mkPricing = (model_name: string, is_free_tier: boolean) => ({
      model_name,
      display_name: model_name,
      context_length: 64000,
      input_modalities: ["text"],
      supported_parameters: ["tools"],
      is_free_tier,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).startsWith("https://api.orcarouter.ai/")) {
          return {
            ok: true,
            json: async () => ({
              data: [
                ...LIVE_PRICING_SHAPE_DATA,
                // churn simulation: a brand-new free model, a paid model, and
                // a stale free-suffixed id without the flag — all resolve by flag.
                mkPricing("vendor/brand-new-free", true),
                mkPricing("orcarouter/fusion-ultra", false),
                mkPricing("qwen/qwen3.8-27b-free", false),
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
    // Only flagged-free ids counted: 3 catalog ids + router alias + brand-new.
    // The fusion-ultra paid id and the stale qwen suffix-id never entered.
    expect(orca?.count).toBe(5);
    expect(orca?.newlyFree).toContain("vendor/brand-new-free");
    expect(MODEL_REGISTRY.some((m) => m.id === "vendor/brand-new-free")).toBe(true);
    expect(MODEL_REGISTRY.some((m) => m.id === "orcarouter/fusion-ultra")).toBe(false);
    expect(MODEL_REGISTRY.some((m) => m.id === "orcarouter/fusion")).toBe(false);
    expect(report.refreshedAt).not.toBeNull();
  });

  it("demotes the delisted qwen to (Paid) when the catalog drops its flag", async () => {
    // Precondition: qwen present as a free entry (as it ships statically;
    // an earlier test in this file may already have demoted it — restore).
    registerModel({
      id: "qwen/qwen3.8-27b-free",
      providerId: "orcarouter",
      displayName: "Qwen: Qwen3.8 27B (Free)",
      contextWindow: 128_000,
      supportsTools: true,
      supportsVision: false,
      isFree: true,
    });
    expect(MODEL_REGISTRY.find((m) => m.id === "qwen/qwen3.8-27b-free")?.isFree).toBe(true);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ data: LIVE_PRICING_SHAPE_DATA }) }))
    );
    const report = await syncFreeModels({
      sources: [createOrcarouterFreeSource()],
      ttlMs: 0,
    });
    const orca = report.results.find((r) => r.sourceId === "orcarouter");
    expect(orca?.ok).toBe(true);
    // The live retirement path: omitted-from-flagged ⇒ demoted, not deleted.
    expect(orca?.noLongerFree).toContain("qwen/qwen3.8-27b-free");
    const qwen = MODEL_REGISTRY.find((m) => m.id === "qwen/qwen3.8-27b-free");
    expect(qwen?.isFree).toBe(false);
    expect(qwen?.displayName).toMatch(/\(Paid\)$/);
    // The replacement is registered in the same sync.
    expect(MODEL_REGISTRY.some((m) => m.id === "z-ai/glm-5.3-flash-free")).toBe(true);
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
      id: "z-ai/glm-5.3-flash-free",
      providerId: "orcarouter",
      displayName: "Z.ai: GLM 5.3 Flash (Free)",
      contextWindow: 2_000_000, // e.g. context window learned from live data
      supportsTools: true,
      supportsVision: true,
      isFree: true,
    });
    const matches = MODEL_REGISTRY.filter((m) => m.id === "z-ai/glm-5.3-flash-free");
    expect(matches.length).toBe(1);
    expect(matches[0].contextWindow).toBe(2_000_000);
  });
});
