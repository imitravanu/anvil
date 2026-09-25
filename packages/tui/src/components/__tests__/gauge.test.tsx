import { describe, expect, it } from "vitest";
import { frameText, renderThemed } from "../../test-utils/testRender.js";
import { ContextGauge, gaugeDisplayText } from "../ContextGauge.js";

describe("gaugeDisplayText", () => {
  it("adapts to width variants", () => {
    expect(gaugeDisplayText(21760, 32000, 130)).toBe("███████░░░ 68% (21.8k / 32.0k)");
    expect(gaugeDisplayText(21760, 32000, 100)).toBe("████░░ 68%");
    expect(gaugeDisplayText(21760, 32000, 60)).toBe("68%");
  });

  it("returns null without a window", () => {
    expect(gaugeDisplayText(100, undefined, 100)).toBeNull();
    expect(gaugeDisplayText(100, 0, 100)).toBeNull();
  });

  it("draws the theme-selected meter (block default, thin override)", () => {
    expect(gaugeDisplayText(16000, 32000, 100)).toBe("███░░░ 50%");
    expect(gaugeDisplayText(16000, 32000, 100, "thin")).toBe("━━━─── 50%");
    expect(gaugeDisplayText(16000, 32000, 130, "thin")).toBe("━━━━━───── 50% (16.0k / 32.0k)");
  });
});

describe("ContextGauge render", () => {
  it("renders the wide form with counts", () => {
    const rendered = renderThemed(<ContextGauge inputTokens={21760} contextWindow={32000} width={130} />);
    expect(frameText(rendered.lastFrame)).toContain("68% (21.8k / 32.0k)");
    rendered.unmount();
  });

  it("renders nothing without a window", () => {
    const rendered = renderThemed(<ContextGauge inputTokens={100} contextWindow={undefined} width={130} />);
    expect(frameText(rendered.lastFrame)).toBe("");
    rendered.unmount();
  });
});
