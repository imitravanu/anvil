import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
  getRateLimitedModels,
  isRateLimited,
  isRateLimitMessage,
  noteRateLimited,
  syncFreeModels,
  type FreeModelSource,
} from "../freeModels.js";

describe("Phase 8 (B) — free-model coordinator", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-p8b-"));
    process.env.ANVIL_HOME = tmp;
  });
  afterEach(() => {
    delete process.env.ANVIL_HOME;
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
});