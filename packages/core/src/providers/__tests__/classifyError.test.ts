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

  // Takeover 2026-10-10: HTTP 500 is transient upstream weather for every major
  // LLM API (their own SDKs retry it), but it fell through to UNKNOWN —
  // non-retryable — while 502/503/504 retried. RED first: both rows returned
  // UNKNOWN against the pre-change classifier.
  it("classifies a real HTTP 500 as retryable server overload", () => {
    const info = classifyProviderError(Object.assign(new Error("Internal Server Error"), { status: 500 }));
    expect(info.code).toBe("SERVER_OVERLOADED");
    expect(info.isRetryable).toBe(true);
  });

  it("infers 'HTTP 500' from prose as retryable overload", () => {
    const info = classifyProviderError(new Error("HTTP 500: something broke upstream"));
    expect(info.code).toBe("SERVER_OVERLOADED");
    expect(info.isRetryable).toBe(true);
  });

  it("does not let incidental prose numbers become error classes (inferred-status misfire)", () => {
    // "retry after 400 tokens" is rate-limit prose; the bare 400 used to be
    // read as a status and the message classified INVALID_REQUEST — a
    // retryable truth turned non-retryable by a number that was never a
    // status. RED first: this returned INVALID_REQUEST.
    const info = classifyProviderError(new Error("Rate limit exceeded — retry after 400 tokens"));
    expect(info.code).toBe("RATE_LIMIT");
    expect(info.isRetryable).toBe(true);
  });

  it("keeps trusting an error class that arrives on the message the old way", () => {
    // The availability-only inference must not weaken the message-carried
    // error classes: bare "401/404/invalid_request" prose still classifies
    // through their message patterns (same verdicts as before, by a different
    // route now that an inferred 400/401/404 is no longer trusted as a status).
    expect(classifyProviderError(new Error("401 Unauthorized")).code).toBe("AUTH_FAILED");
    expect(classifyProviderError(new Error("404 model not found: no such model")).code).toBe("MODEL_NOT_FOUND");
    expect(classifyProviderError(new Error("400 invalid_request: bad field")).code).toBe("INVALID_REQUEST");
  });
});
