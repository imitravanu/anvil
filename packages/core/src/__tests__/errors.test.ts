import { describe, it, expect } from "vitest";
import { getErrorMessage } from "../errors.js";

describe("getErrorMessage", () => {
  it("extracts message from standard Error", () => {
    const err = new Error("Network timeout");
    expect(getErrorMessage(err)).toBe("Network timeout");
  });

  it("extracts message from custom Error subclass", () => {
    class CustomProviderError extends Error {
      code = 429;
    }
    const err = new CustomProviderError("Rate limit exceeded");
    expect(getErrorMessage(err)).toBe("Rate limit exceeded");
  });

  it("returns raw string error directly", () => {
    expect(getErrorMessage("Direct error message")).toBe("Direct error message");
  });

  it("extracts message property from non-Error objects", () => {
    const obj = { message: "API failure", status: 500 };
    expect(getErrorMessage(obj)).toBe("API failure");
  });

  it("stringifies primitives and objects without message", () => {
    expect(getErrorMessage(500)).toBe("500");
    expect(getErrorMessage(null)).toBe("null");
    expect(getErrorMessage(undefined)).toBe("undefined");
    expect(getErrorMessage({ code: 404 })).toBe("[object Object]");
  });
});
