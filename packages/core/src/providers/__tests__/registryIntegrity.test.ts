import { describe, expect, it } from "vitest";
import { MODEL_REGISTRY, getModel } from "../registry.js";
import { createProviders } from "../index.js";
import type { CertificationStatus, ModelInfo } from "../types.js";

/**
 * REGISTRY INTEGRITY GUARD
 *
 * The registry is hand-edited data (~80 curated rows) plus runtime-injected
 * free-model sync rows. Shape mistakes here are silent: a missing contextWindow
 * biases compaction, a bogus providerId drops the row from its picker, and a
 * `certified: "live"` without provenance is exactly the over-claim the
 * certifiedMode field exists to stop. These assertions make the class
 * mechanical so per-row review can focus on meaning, not shape.
 */

const KNOWN_PROVIDER_IDS = new Set(Object.keys(createProviders({})));
const CERT_STATUSES: readonly CertificationStatus[] = ["live", "broken", "untested"];

describe("MODEL_REGISTRY integrity", () => {
  it("is non-empty", () => {
    expect(MODEL_REGISTRY.length).toBeGreaterThan(0);
  });

  it("every row has a well-formed shape", () => {
    for (const m of MODEL_REGISTRY) {
      const where = `${m.providerId}/${m.id}`;
      expect(m.id, "id must be a non-empty string").toBeTypeOf("string");
      expect(m.id.length, `id must be non-empty (${where})`).toBeGreaterThan(0);
      expect(m.providerId, `providerId must be a non-empty string (${where})`).toBeTypeOf("string");
      expect(m.providerId.length, `providerId must be non-empty (${where})`).toBeGreaterThan(0);
      expect(m.displayName, `displayName must be a non-empty string (${where})`).toBeTypeOf("string");
      expect(m.displayName.trim().length, `displayName must be non-empty (${where})`).toBeGreaterThan(0);
      expect(
        Number.isFinite(m.contextWindow) && m.contextWindow > 0,
        `contextWindow must be a positive finite number (${where})`
      ).toBe(true);
      expect(m.supportsTools, `supportsTools must be boolean (${where})`).toBeTypeOf("boolean");
      expect(m.supportsVision, `supportsVision must be boolean (${where})`).toBeTypeOf("boolean");
      if (m.isFree !== undefined) {
        expect(m.isFree, `isFree must be boolean when present (${where})`).toBeTypeOf("boolean");
      }
    }
  });

  it("every row names a known provider (no orphan rows)", () => {
    for (const m of MODEL_REGISTRY) {
      expect(
        KNOWN_PROVIDER_IDS.has(m.providerId),
        `row ${m.providerId}/${m.id} names a provider createProviders does not know`
      ).toBe(true);
    }
  });

  it("has no duplicate provider-qualified ids", () => {
    const seen = new Set<string>();
    for (const m of MODEL_REGISTRY) {
      const key = `${m.providerId}:${m.id}`;
      expect(seen.has(key), `duplicate registry row for ${key}`).toBe(false);
      seen.add(key);
    }
  });

  it("certification provenance is consistent (no live claim without evidence)", () => {
    for (const m of MODEL_REGISTRY) {
      const where = `${m.providerId}/${m.id}`;
      if (m.certified !== undefined) {
        expect(CERT_STATUSES, `invalid certified status for ${where}`).toContain(m.certified);
      }
      if (m.certifiedMode !== undefined) {
        expect(["mock", "live"], `invalid certifiedMode for ${where}`).toContain(m.certifiedMode);
      }
      // A live/broken verdict is a recorded observation: it must carry a date
      // and a provenance mode, or it cannot be told apart from a guess.
      if (m.certified === "live" || m.certified === "broken") {
        expect(m.certifiedAt, `${where} is certified "${m.certified}" but has no certifiedAt`).toBeTypeOf("string");
        expect(
          Number.isFinite(Date.parse(m.certifiedAt as string)),
          `${where} has an unparseable certifiedAt: ${String(m.certifiedAt)}`
        ).toBe(true);
        expect(m.certifiedMode, `${where} is certified "${m.certified}" but records no certifiedMode`).toBeDefined();
      }
      if (m.certified === "untested") {
        expect(m.certifiedAt, `${where} is untested but carries a certifiedAt`).toBeUndefined();
      }
    }
  });

  it("every row is retrievable by its provider-qualified lookup", () => {
    for (const m of MODEL_REGISTRY) {
      const found = getModel(m.id, m.providerId);
      expect(found, `getModel(${m.id}, ${m.providerId}) returned nothing`).toBeDefined();
      expect(found?.id).toBe(m.id);
      expect(found?.providerId).toBe(m.providerId);
    }
  });

  it("every known provider has at least one model", () => {
    for (const id of KNOWN_PROVIDER_IDS) {
      expect(
        MODEL_REGISTRY.some((m) => m.providerId === id),
        `provider ${id} has no registry rows — it would be unusable`
      ).toBe(true);
    }
  });

  it("each provider's implicit default (first row) supports tools", () => {
    // resolveProviderSelection falls back to the FIRST registry row for the
    // provider, so a tool-incapable first row would boot the agent with a model
    // that can never call a tool. Keep tool-incapable models ordered after a
    // capable default (qwq-plus / qwen-vl-max are three rows deep).
    const byProvider = new Map<string, ModelInfo[]>();
    for (const m of MODEL_REGISTRY) {
      const list = byProvider.get(m.providerId);
      if (list) list.push(m);
      else byProvider.set(m.providerId, [m]);
    }
    for (const [providerId, models] of byProvider) {
      expect(
        models[0].supportsTools,
        `${providerId}'s default pick (${models[0].id}) cannot call tools`
      ).toBe(true);
    }
  });
});
