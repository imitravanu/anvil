import { describe, expect, it } from "vitest";
import { transcriptDetails } from "../transcriptDetails.js";

describe("retained transcript details", () => {
  it("reaches tool content in resumed history without serializing images or provider metadata", () => {
    const details = transcriptDetails([], [{ role: "assistant", content: [
      { type: "tool_call", call: { id: "call", name: "read_file", input: { path: "fixture.ts" }, providerMetadata: { opaque: "PRIVATE_METADATA" } } },
    ] }, { role: "user", content: [
      { type: "tool_result", result: { toolCallId: "call", content: "FULL_RETAINED_OUTPUT", isError: false } },
      { type: "image", mediaType: "image/png", data: "SECRET_IMAGE_BYTES" },
    ] }]);
    expect(details).toContain("FULL_RETAINED_OUTPUT");
    expect(details).not.toContain("SECRET_IMAGE_BYTES");
    expect(details).not.toContain("PRIVATE_METADATA");
    expect(details).toContain("may have been compacted");
  });
});
