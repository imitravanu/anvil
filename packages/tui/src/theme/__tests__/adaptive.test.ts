import { describe, expect, it } from "vitest";
import { detectTerminalTheme } from "../adaptive.js";

describe("detectTerminalTheme", () => {
  it("returns null without COLORFGBG", () => {
    expect(detectTerminalTheme({})).toBeNull();
  });

  it("maps dark backgrounds", () => {
    expect(detectTerminalTheme({ COLORFGBG: "15;0" })).toBe("dark");
    expect(detectTerminalTheme({ COLORFGBG: "0;8" })).toBe("dark");
    expect(detectTerminalTheme({ COLORFGBG: "7;6" })).toBe("dark");
  });

  it("maps light backgrounds", () => {
    expect(detectTerminalTheme({ COLORFGBG: "0;7" })).toBe("light");
    expect(detectTerminalTheme({ COLORFGBG: "0;15" })).toBe("light");
  });

  it("returns null for garbage", () => {
    expect(detectTerminalTheme({ COLORFGBG: "nope" })).toBeNull();
    expect(detectTerminalTheme({ COLORFGBG: "0;99" })).toBeNull();
  });
});
