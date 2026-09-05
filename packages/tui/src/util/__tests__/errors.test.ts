import { describe, expect, it } from "vitest";
import { friendlyError } from "../errors.js";

describe("friendlyError", () => {
  it("maps a raw multi-line quota dump to one actionable line", () => {
    const raw = [
      "You exceeded your current quota, please check your plan and billing details. For more information on this error, head to: https://ai.google.dev/gemini-api/docs/rate-limits.",
      "  • Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 5, model: gemini-3.6-flash",
      "Please retry in 53.246557959s.",
    ].join("\n");
    const out = friendlyError(raw);
    expect(out).toContain("Rate limit reached");
    expect(out).toContain("~54s");
    expect(out).toContain("/model");
    expect(out).not.toContain("https://");
  });

  it("maps auth failures to the /connect next step", () => {
    expect(friendlyError("Error: 401 - invalid x-api-key")).toContain("/connect");
  });

  it("maps context-overflow to /clear guidance", () => {
    expect(friendlyError("prompt is too long: 1200000 tokens > 1000000 maximum")).toContain("/clear");
  });

  it("keeps small unknown errors verbatim, truncates multi-line walls", () => {
    expect(friendlyError("connection refused")).toBe("connection refused");
    const wall = ["line1", "line2", "line3", "line4"].join("\n");
    expect(friendlyError(wall)).toBe("line1 … (+3 more lines)");
  });
});
