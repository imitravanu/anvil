import { describe, expect, it } from "vitest";
import { classifyProviderError } from "../types.js";

describe("classifyProviderError", () => {
  it("classifies a 429 as a retryable rate limit", () => {
    const info = classifyProviderError(Object.assign(new Error("slow down"), { status: 429 }));
    expect(info.code).toBe("RATE_LIMIT");
    expect(info.isRetryable).toBe(true);
  });

  it("classifies 502/503/504 as retryable server overload", () => {
    for (const status of [502, 503, 504]) {
      const info = classifyProviderError(Object.assign(new Error("upstream"), { status }));
      expect(info.code).toBe("SERVER_OVERLOADED");
      expect(info.isRetryable).toBe(true);
    }
  });

  it("classifies 401/403 as non-retryable auth failures", () => {
    for (const status of [401, 403]) {
      const info = classifyProviderError(Object.assign(new Error("nope"), { status }));
      expect(info.code).toBe("AUTH_FAILED");
      expect(info.isRetryable).toBe(false);
    }
  });

  it("classifies a 404 as a non-retryable model-not-found", () => {
    const info = classifyProviderError(Object.assign(new Error("gone"), { status: 404 }));
    expect(info.code).toBe("MODEL_NOT_FOUND");
    expect(info.isRetryable).toBe(false);
  });

  it("treats a context-overflow message as CONTEXT_OVERFLOW even when it rides an HTTP 400", () => {
    // Regression: the generic `status === 400 → INVALID_REQUEST` return used to
    // execute first, making the CONTEXT_OVERFLOW branch unreachable for the
    // shape providers actually send (400 + a context-length message).
    for (const message of [
      "context_length_exceeded: your message was too long",
      "This model's maximum context length is 128000 tokens",
      "prompt is too long: 210000 tokens > 200000 maximum",
    ]) {
      const info = classifyProviderError(Object.assign(new Error(message), { status: 400 }));
      expect(info.code, message).toBe("CONTEXT_OVERFLOW");
      expect(info.httpStatus).toBe(400);
      expect(info.isRetryable).toBe(false);
    }
  });

  it("classifies a context-overflow message with no HTTP status", () => {
    const info = classifyProviderError(new Error("context overflow: reduce your input"));
    expect(info.code).toBe("CONTEXT_OVERFLOW");
    expect(info.httpStatus).toBe(400);
  });

  it("still classifies a generic 400 with no overflow signal as INVALID_REQUEST", () => {
    const info = classifyProviderError(
      Object.assign(new Error("invalid_request_error: missing field 'model'"), { status: 400 })
    );
    expect(info.code).toBe("INVALID_REQUEST");
    expect(info.isRetryable).toBe(false);
  });

  it("falls back to UNKNOWN for an unrecognized error", () => {
    const info = classifyProviderError(new Error("something inscrutable happened"));
    expect(info.code).toBe("UNKNOWN");
    expect(info.isRetryable).toBe(false);
  });
});
