import { describe, expect, it } from "vitest";
import { MODEL_REGISTRY } from "../registry.js";

// Certification provenance: a "live" status must say HOW it was earned, so a
// passing mock run can never be rendered as a real-provider probe. This is the
// registry-level guard behind the `[✅ mock]` / `[✅ live]` badge split.
describe("MODEL_REGISTRY certification provenance", () => {
  it("every live status records a mode and a timestamp", () => {
    const live = MODEL_REGISTRY.filter((m) => m.certified === "live");
    expect(live.length).toBeGreaterThan(0);
    for (const m of live) {
      expect(m.certifiedMode, `${m.id} is certified live without a mode`).toMatch(/^(mock|live)$/);
      expect(m.certifiedAt, `${m.id} is certified live without a timestamp`).toBeTruthy();
    }
  });

  it("records the 2026-09-10 batch as mock, not live", () => {
    // That batch came from `certify --mock --all`; none of it is a probe.
    const batch = MODEL_REGISTRY.filter((m) => m.certifiedAt?.startsWith("2026-09-10"));
    expect(batch.length).toBeGreaterThan(0);
    for (const m of batch) expect(m.certifiedMode).toBe("mock");
  });

  it("keeps the retired Gemini id broken, with live-probe provenance", () => {
    const m = MODEL_REGISTRY.find((x) => x.id === "gemini-2.0-flash");
    expect(m?.certified).toBe("broken");
    expect(m?.certifiedMode).toBe("live");
  });
});
