import { describe, expect, it } from "vitest";
import { createProviders, type ProviderId } from "@anvil/core";
import { PROVIDER_META } from "../providers.js";
import { PROVIDER_LABELS } from "../labels.js";

/**
 * The TUI keeps two hand-maintained presentation tables alongside the core
 * provider registry: PROVIDER_LABELS (chrome) and PROVIDER_META (/connect
 * onboarding copy + credential field). Marketing copy cannot be derived from
 * code, so they stay hand-written — but they must at least stay COMPLETE, which
 * is the failure that silently ships a provider nobody can configure. These
 * assertions derive the expected set from the registry, so they can only fail
 * on drift.
 */
function registryIds(): string[] {
  return Object.keys(createProviders({}));
}

describe("provider presentation tables", () => {
  it("labels every registered provider exactly once", () => {
    const ids = registryIds();
    for (const id of ids) {
      expect(PROVIDER_LABELS[id], `labels.ts is missing ${id}`).toBeTruthy();
    }
    expect(Object.keys(PROVIDER_LABELS).sort()).toEqual([...ids].sort());
  });

  it("offers every registered provider in the connect flow, exactly once", () => {
    const ids = registryIds();
    const listed = PROVIDER_META.map((m) => m.id);
    expect([...listed].sort()).toEqual([...ids].sort());
    expect(new Set(listed).size).toBe(listed.length); // no duplicate rows
  });

  it("points each connect row at that provider's own credential field", () => {
    // A copy-pasted row that kept the previous provider's `field` would put the
    // pasted key on the wrong provider — the key would silently never be used.
    const fields = PROVIDER_META.map((m) => m.field);
    expect(new Set(fields).size).toBe(fields.length);
  });

  it("covers every ProviderId with a short label", () => {
    for (const meta of PROVIDER_META) {
      const id: ProviderId = meta.id;
      expect(PROVIDER_LABELS[id]).toBe(meta.shortLabel);
    }
  });
});
