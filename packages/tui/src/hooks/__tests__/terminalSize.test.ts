import { describe, expect, it } from "vitest";
import { breakpointForWidth } from "../useTerminalSize.js";
import { DEFAULT_RESPONSIVE } from "../../theme/themes.js";

describe("breakpointForWidth", () => {
  it("maps DW-1.3 bands with default thresholds", () => {
    expect(breakpointForWidth(40)).toBe("compact");
    expect(breakpointForWidth(79)).toBe("compact");
    expect(breakpointForWidth(80)).toBe("normal");
    expect(breakpointForWidth(119)).toBe("normal");
    expect(breakpointForWidth(120)).toBe("wide");
    expect(breakpointForWidth(159)).toBe("wide");
    expect(breakpointForWidth(160)).toBe("ultraWide");
    expect(breakpointForWidth(300)).toBe("ultraWide");
  });

  it("honors custom theme thresholds", () => {
    const custom = { ...DEFAULT_RESPONSIVE, compactWidth: 70 };
    expect(breakpointForWidth(70, custom)).toBe("normal");
    expect(breakpointForWidth(69, custom)).toBe("compact");
  });
});
