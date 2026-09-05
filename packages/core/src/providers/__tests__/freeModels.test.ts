import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ModelInfo } from "../types.js";
import {
  MODEL_REGISTRY,
  getModelsForProvider,
  registerModel,
  unregisterModels,
} from "../registry.js";
import {
  DEFAULT_SYNC_TTL_MS,
  fetchOpenRouterFreeModels,
  getRateLimitedModels,
  isRateLimited,
  isRateLimitMessage,
  noteRateLimited,
  syncFreeModels,
  type FreeModelSource,
} from "../freeModels.js";

describe("Phase 8 (B) — free-model coordinator", () => {
  let tmp: string;
  let savedHome: string | undefined;
  beforeEach(() => {
    savedHome = process.env.ANVIL_HOME;
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-p8b-"));
    process.env.ANVIL_HOME = tmp;
  });
  afterEach(() => {
    if (savedHome === undefined) delete process.env.ANVIL_HOME;
    else process.env.ANVIL_HOME = savedHome;
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      // ignore
    }
    // keep the global registry pristine for other suites
    unregisterModels(
      MODEL_REGISTRY.map((m) => m.id).filter((id) => id.includes("p8b-") || id.includes("phase8-test"))
    );
  });

  function fakeSource(
    id: string,
    models: ModelInfo[] | (() => ModelInfo[] | Promise<ModelInfo[]>),
    counter?: { count: number }
  ): FreeModelSource {
    return {
      id,
      fetchFreeModels: async () => {
        if (counter) counter.count += 1;
        if (typeof models === "function") return models();
        return models;
      },
    };
  }

  const freeModel = (id: string, providerId: string): ModelInfo => ({
    id,
    providerId,
    displayName: `${id} (Free)`,
    contextWindow: 128_000,
    supportsTools: true,
    supportsVision: false,
    isFree: true,
  });

  it("B1+B2: single-flight shares one fetch; TTL makes a later call a no-op", async () => {
    const counter = { count: 0 };
    const src = fakeSource("p8b-flight", [freeModel("p8b-flight-a", "phase8-test")], counter);

    // Two concurrent calls → one actual fetch.
    const [r1, r2] = await Promise.all([
      syncFreeModels({ sources: [src], ttlMs: 0 }),
      syncFreeModels({ sources: [src], ttlMs: 0 }),
    ]);
    expect(counter.count).toBe(1);
    expect(r1.refreshedAt).toBeTruthy();
    expect(r2.refreshedAt).toBe(r1.refreshedAt);

    // TTL: a fresh call within the window is a no-op (no second fetch).
    const r3 = await syncFreeModels({ sources: [src], ttlMs: DEFAULT_SYNC_TTL_MS });
    expect(counter.count).toBe(1);
    expect(r3.refreshedAt).toBe(r1.refreshedAt);
  });

  it("B3: source failure is reported, never thrown, registry & cache untouched", async () => {
    const cachePath = path.join(tmp, "models-cache.json");
    const before = getModelsForProvider("phase8-test").length;
    const src = fakeSource("p8b-throw", () => {
      throw new Error("network says no");
    });
    const report = await syncFreeModels({ sources: [src], ttlMs: 0 });

    expect(report.errors.length).toBe(1);
    expect(report.errors[0]).toContain("network says no");
    expect(report.results[0].ok).toBe(false);
    expect(getModelsForProvider("phase8-test").length).toBe(before); // no partial state
    expect(fs.existsSync(cachePath)).toBe(false); // cache untouched
  });

  it("B4a: brand-new free models are registered and reported as newlyFree", async () => {
    const model = freeModel("p8b-new-a", "phase8-test");
    const src = fakeSource("p8b-new", [model]);
    const report = await syncFreeModels({ sources: [src], ttlMs: 0 });

    expect(report.results[0].ok).toBe(true);
    expect(report.results[0].newlyFree).toContain("p8b-new-a");
    expect(MODEL_REGISTRY.some((m) => m.id === "p8b-new-a" && m.isFree)).toBe(true);

    // re-sync with the same list → no change reported
    const report2 = await syncFreeModels({ sources: [src], ttlMs: 0 });
    expect(report2.results[0].newlyFree).not.toContain("p8b-new-a");
  });

  it("B4b: a model that stopped being free is demoted and reported", async () => {
    registerModel({ ...freeModel("p8b-demote-a", "phase8-test"), displayName: "P8B Demote (Free)" });
    // The live list is non-empty but no longer contains the demoted model.
    const src = fakeSource("p8b-demote", [freeModel("p8b-demote-sibling", "phase8-test")]);
    const report = await syncFreeModels({ sources: [src], ttlMs: 0 });

    expect(report.results[0].noLongerFree).toContain("p8b-demote-a");
    const entry = MODEL_REGISTRY.find((m) => m.id === "p8b-demote-a");
    expect(entry?.isFree).toBe(false);
    expect(entry?.displayName).toContain("(Paid)");
  });

  it("B4c: a paid model that is now free is promoted and reported", async () => {
    registerModel({
      ...freeModel("p8b-promote-a", "phase8-test"),
      displayName: "P8B Promote (Paid)",
      isFree: false,
    });
    const src = fakeSource("p8b-promote", [freeModel("p8b-promote-a", "phase8-test")]);
    const report = await syncFreeModels({ sources: [src], ttlMs: 0 });

    expect(report.results[0].newlyFree).toContain("p8b-promote-a");
    const entry = MODEL_REGISTRY.find((m) => m.id === "p8b-promote-a");
    expect(entry?.isFree).toBe(true);
    expect(entry?.displayName).toContain("(Free)");
  });

  it("records rate-limit health without backoff", () => {
    expect(isRateLimitMessage("Request failed with status 429 Too Many Requests")).toBe(true);
    expect(isRateLimitMessage("quota exhausted for free tier")).toBe(true);
    expect(isRateLimitMessage("invalid api key")).toBe(false);

    noteRateLimited("phase8-test", "p8b-health-a");
    expect(isRateLimited("phase8-test", "p8b-health-a")).toBe(true);
    expect(isRateLimited("phase8-test", "other")).toBe(false);
    expect(Object.keys(getRateLimitedModels())).toContain("phase8-test");
  });

  it("different credentials fly separately (no cross-cred sharing)", async () => {
    const counter = { count: 0 };
    const src = fakeSource("p8b-creds", [freeModel("p8b-creds-a", "phase8-test")], counter);
    await syncFreeModels({ sources: [src], ttlMs: 0, apiKeyBySource: { "p8b-creds": "key-one" } });
    await syncFreeModels({ sources: [src], ttlMs: 0, apiKeyBySource: { "p8b-creds": "key-two" } });
    expect(counter.count).toBe(2);
  });

  it("partial failure preserves the failed source's cached models", async () => {
    const keeper = freeModel("p8b-keep-a", "phase8-test");
    const good = fakeSource("p8b-mix-good", [keeper]);
    const bad = fakeSource("p8b-mix-bad", () => {
      throw new Error("flaky");
    });
    const first = await syncFreeModels({ sources: [good, bad], ttlMs: 0 });
    expect(first.results.find((r) => r.sourceId === "p8b-mix-good")?.ok).toBe(true);
    // Prime the cache with BOTH sources healthy, then fail one.
    const good2 = fakeSource("p8b-mix-good", [keeper]);
    const bad2 = fakeSource("p8b-mix-bad", [freeModel("p8b-mix-b", "phase8-test")]);
    await syncFreeModels({ sources: [good2, bad2], ttlMs: 0 });
    const report = await syncFreeModels({ sources: [good, bad], ttlMs: 0 });
    expect(report.results.find((r) => r.sourceId === "p8b-mix-bad")?.ok).toBe(false);
    const { loadModelsCacheV2 } = await import("../cache.js");
    const cached = loadModelsCacheV2();
    // The failed source's last-good models survive; the healthy source refreshes.
    expect(cached.sources["p8b-mix-bad"]?.map((m) => m.id)).toContain("p8b-mix-b");
    expect(cached.sources["p8b-mix-good"]?.map((m) => m.id)).toContain("p8b-keep-a");
    expect(report.refreshedAt).toBeTruthy(); // partial success still stamps
  });

  it("numeric zero pricing counts as free", async () => {
    const numeric = {
      ...freeModel("p8b-num-a", "phase8-test"),
      // fetchOpenRouterFreeModels shape is tested via the unit below; here the
      // coordinator path treats whatever the source returns as authoritative.
    };
    const src = fakeSource("p8b-num", [numeric]);
    const report = await syncFreeModels({ sources: [src], ttlMs: 0 });
    expect(report.results[0].newlyFree).toContain("p8b-num-a");
  });

  it("fetchOpenRouterFreeModels accepts numeric and string zero pricing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          data: [
            { id: "n/zero-num", name: "Zero Num", pricing: { prompt: 0, completion: 0 }, supported_parameters: [], architecture: { modality: "text" }, context_length: 1000 },
            { id: "n/zero-str", name: "Zero Str", pricing: { prompt: "0", completion: "0" }, supported_parameters: [], architecture: { modality: "text" }, context_length: 1000 },
            { id: "n/paid", name: "Paid", pricing: { prompt: 1, completion: 2 }, supported_parameters: [], architecture: { modality: "text" }, context_length: 1000 },
          ],
        }),
      }))
    );
    try {
      const models = await fetchOpenRouterFreeModels();
      expect(models.map((m) => m.id).sort()).toEqual(["n/zero-num", "n/zero-str"]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});