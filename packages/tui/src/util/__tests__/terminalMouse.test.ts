import { describe, expect, it } from "vitest";
import { terminalMouseInput } from "../terminalMouse.js";

describe("terminal mouse reports", () => {
  it.each([
    ["\x1b[<64;20;10M", "up"],
    ["[<65;20;10M", "down"],
    ["[<68;20;10M", "up"],
    ["[<81;20;10M", "down"],
    ["[<64;300;100M", "up"],
    ["[<0;20;10M", null],
    ["[<0;20;10m", null],
    ["[<64;20;10m", null],
    ["[<66;20;10M", null],
    ["[<67;20;10M", null],
    ["[<96;20;10M", null],
    ["[<192;20;10M", null],
    ["[<64;0;10M", null],
    ["[<64;20;0M", null],
    ["[<64;9007199254740992;10M", null],
  ])("consumes %j with vertical direction %j", (input, direction) => {
    expect(terminalMouseInput(input!)).toEqual({ direction });
  });

  it.each(["hello", "y", "[A", "[B", "[<64;20;", "[<64;-1;10M", "[<64;20;10Mextra"])("does not reinterpret non-report input %j", input => {
    expect(terminalMouseInput(input)).toBeNull();
  });
});
