import { describe, expect, it } from "vitest";
import { MODEL_REGISTRY, getModel, visibleModels } from "../registry.js";

/**
 * PHASE 38.3 — NO MODEL IS ADVERTISED THAT THE GATEWAY REFUSES
 *
 * Probe N measured `thinkingmachines/inkling:free` and `inkling-small:free`
 * returning HTTP 403 "only available on agentic harnesses", verified with
 * Anvil's exact attribution headers because a bare request 403s too and could
 * not separate "unreachable" from "my probe lacked headers".
 *
 * Both rows shipped as `certified: "live"` from a `certifiedMode: "mock"` run.
 * The mock lane certifies an id's SHAPE, never its reachability, so the verdict
 * was recorded without ever touching the gateway. The picker then offered two
 * models that fail for every user who selects them.
 *
 * This guard is deliberately scoped to the ids the probe MEASURED, not to every
 * row: Anvil cannot call 75 live endpoints in a unit test, and a guard that
 * pretended to would be a lie. The class is closed instead by pinning the
 * invariant those two rows violated — a model the probe found unreachable is
 * marked `broken`, and the picker renders that as a refusal rather than a badge
 * a user can read past.
 */

/** Ids Probe N measured returning 403 for an Anvil-shaped request. */
const PROBED_UNREACHABLE: ReadonlyArray<{ providerId: string; id: string }> = [
  { providerId: "openrouter", id: "thinkingmachines/inkling:free" },
  { providerId: "openrouter", id: "thinkingmachines/inkling-small:free" },
];

describe("models the gateway refuses are not advertised as working", () => {
  it.each(PROBED_UNREACHABLE)(
    "$providerId/$id is marked broken, not live",
    ({ providerId, id }) => {
      const model = getModel(id, providerId);
      expect(model, `${providerId}/${id} vanished from the registry`).toBeDefined();
      expect(
        model?.certified,
        `${providerId}/${id} returned HTTP 403 in a live probe (Phase 38, Probe N) but is ` +
          `still certified "${model?.certified}". A mock run cannot certify reachability.`,
      ).toBe("broken");
    }
  );

  it.each(PROBED_UNREACHABLE)(
    "$providerId/$id records the live probe as its provenance",
    ({ providerId, id }) => {
      const model = getModel(id, providerId);
      // The verdict is only trustworthy alongside HOW it was obtained, and this
      // one was obtained against the real gateway — unlike the mock run that
      // produced the wrong "live".
      expect(model?.certifiedMode).toBe("live");
      expect(model?.certifiedAt, "a recorded observation needs a timestamp").toBeDefined();
    }
  );

  it("no probed-unreachable model is presented as a working choice", () => {
    // The picker's own rendering of a status lives in @imitravanu/anvil-tui
    // (util/format.ts) and cannot be asserted from here — core must not import
    // from tui. What core owns is the data the renderer reads: a row whose
    // status is "broken" can only ever render as a refusal. The badge mapping
    // itself is asserted in the TUI suite.
    for (const { providerId, id } of PROBED_UNREACHABLE) {
      const model = getModel(id, providerId);
      expect(
        model?.certified === "live",
        `${providerId}/${id} would render as an available option`,
      ).toBe(false);
    }
  });

  it("the picker still lists them, but only as broken — the row is not silently deleted", () => {
    // Deleting the rows would hide the observation and let a future sync
    // re-add them as unknown-but-plausible. Keeping them marked broken is the
    // honest state: the model exists, and it does not work here.
    const visible = visibleModels();
    for (const { providerId, id } of PROBED_UNREACHABLE) {
      const row = visible.find((m) => m.id === id && m.providerId === providerId);
      expect(row, `${providerId}/${id} should remain listed as broken`).toBeDefined();
      expect(row?.certified).toBe("broken");
    }
  });

  it("the guard's own list is honest about what it covers", () => {
    // If a probed id is later fixed, this test is what should fail first — it
    // forces the observation to be revisited rather than left to rot.
    expect(PROBED_UNREACHABLE.length).toBe(2);
    for (const { providerId, id } of PROBED_UNREACHABLE) {
      expect(MODEL_REGISTRY.some((m) => m.id === id && m.providerId === providerId)).toBe(true);
    }
  });
});
