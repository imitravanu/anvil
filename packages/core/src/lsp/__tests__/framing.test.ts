import { describe, expect, it, vi } from "vitest";
import { LspStdioClient } from "../client.js";
import { LSP_MAX_FRAME_BYTES, LSP_MAX_HEADER_BYTES } from "../../config/constants.js";

function parser() {
  return Object.assign(Object.create(LspStdioClient.prototype), {
    buffer: Buffer.alloc(0), dead: false, failAll: vi.fn(), killTree: vi.fn(), onMessage: vi.fn(),
  });
}
describe("bounded LSP framing", () => {
  it.each([1, 1024, LSP_MAX_FRAME_BYTES + 1])("refuses unterminated headers in %s-byte chunks", size => {
    const client = parser();
    for (let bytes = 0; bytes <= LSP_MAX_HEADER_BYTES && !client.dead; bytes += size) client.onData(Buffer.alloc(size, 65));
    expect(client.dead).toBe(true);
    expect(client.buffer.length).toBe(0);
    expect(client.failAll).toHaveBeenCalledWith(expect.objectContaining({ message: "LSP frame exceeds size cap" }));
    expect(client.killTree).toHaveBeenCalledWith("SIGKILL");
  });
  it("accepts fragmented frames and large chunks containing multiple valid frames", () => {
    const client = parser();
    const payload = "x".repeat(LSP_MAX_FRAME_BYTES / 2);
    const frame = Buffer.from(`Content-Length: ${payload.length}\r\n\r\n${payload}`);
    client.onData(frame.subarray(0, 5));
    client.onData(Buffer.concat([frame.subarray(5), frame, frame]));
    expect(client.onMessage).toHaveBeenCalledTimes(3);
    expect(client.dead).toBe(false);
    expect(client.buffer.length).toBe(0);
  });
});
