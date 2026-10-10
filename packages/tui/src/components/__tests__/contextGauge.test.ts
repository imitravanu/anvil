import { describe, expect, it } from "vitest";
import { gaugeVariantForWidth, gaugeDisplayText } from "../ContextGauge.js";

describe("gaugeVariantForWidth (theme.responsive routing)", () => {
  it("keeps the default-theme thresholds", () => {
    expect(gaugeVariantForWidth(79)).toBe("compact");
    expect(gaugeVariantForWidth(80)).toBe("normal");
    expect(gaugeVariantForWidth(119)).toBe("normal");
    expect(gaugeVariantForWidth(120)).toBe("wide");
  });

  it("follows a custom theme's responsive tokens instead of the defaults", () => {
    // Takeover 2026-10-10: the variant ladder was hardcoded (80/120) while the
    // theme carried validated responsive tokens — a custom theme moved the
    // status bar's compact collapse (the one breakpointForWidth consumer) but
    // not the gauge, so the chrome visibly desynced. RED against the
    // pre-change code: width 130 read "wide" from the hardcoded 120.
    const custom = { compactWidth: 100, normalWidth: 140, wideWidth: 180 };
    expect(gaugeVariantForWidth(99, custom)).toBe("compact");
    expect(gaugeVariantForWidth(100, custom)).toBe("normal");
    expect(gaugeVariantForWidth(130, custom), "130 is under the custom normalWidth").toBe("normal");
    expect(gaugeVariantForWidth(140, custom)).toBe("wide");
  });

  it("gaugeDisplayText honors the same tokens", () => {
    const custom = { compactWidth: 100, normalWidth: 140, wideWidth: 180 };
    const normal = gaugeDisplayText(50, 100, 130, "block", custom);
    expect(normal).toContain("50%");
    expect(normal, "under the custom normalWidth the counts are not shown yet").not.toContain("50 / 100");
    const wide = gaugeDisplayText(50, 100, 140, "block", custom);
    expect(wide).toContain("50 / 100");
  });
});