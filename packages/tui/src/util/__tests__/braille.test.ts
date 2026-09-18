import { describe, expect, it } from "vitest";
import { brailleSparkline } from "../braille.js";

describe("brailleSparkline", () => {
  it("returns empty for empty input or zero width", () => {
    expect(brailleSparkline([])).toBe("");
    expect(brailleSparkline([1, 2, 3], 0)).toBe("");
  });

  it("renders flat series at mid level", () => {
    expect(brailleSparkline([5, 5, 5])).toBe("⡆⡆⡆");
    expect(brailleSparkline([0])).toBe("⡆");
  });

  it("rises and falls across the full range", () => {
    expect(brailleSparkline([0, 100])).toBe("⠀⡿");
    expect(brailleSparkline([0, 50, 100, 50, 0])).toBe("⠀⡇⡿⡇⠀");
  });

  it("keeps only the newest width samples", () => {
    expect(brailleSparkline([0, 0, 0, 100], 2)).toBe("⠀⡿");
  });

  it("emits single cells only", () => {
    for (const ch of brailleSparkline([3, 1, 4, 1, 5, 9, 2, 6])) {
      expect([...ch].length).toBe(1);
    }
  });
});
