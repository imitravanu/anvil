import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { handleAttachImage } from "../handlers/media.js";
import { IMAGE_MAX_BYTES } from "../../util/displayLimits.js";
import type { CommandHandlerDeps } from "../types.js";

const tmp: string[] = [];

function tmpFile(name: string, bytes: number): string {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "anvil-media-")), name);
  fs.writeFileSync(p, Buffer.alloc(bytes, 1));
  tmp.push(path.dirname(p));
  return p;
}

function deps() {
  const messages: string[] = [];
  const addPendingImage = vi.fn();
  return {
    messages,
    addPendingImage,
    deps: {
      printSystemMessage: (t: string) => messages.push(t),
      addPendingImage,
      currentModel: "some-model",
      isBusy: false,
    } as unknown as CommandHandlerDeps,
  };
}

afterEach(() => {
  for (const dir of tmp.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("handleAttachImage", () => {
  it("attaches a supported image as base64", () => {
    const { messages, addPendingImage, deps: d } = deps();
    handleAttachImage(d, tmpFile("shot.png", 64));
    expect(addPendingImage).toHaveBeenCalledTimes(1);
    expect(addPendingImage.mock.calls[0][0]).toMatchObject({ mediaType: "image/png" });
    expect(messages.join("\n")).toContain("Image attached");
  });

  it("refuses an extension the providers cannot send", () => {
    const { messages, addPendingImage, deps: d } = deps();
    handleAttachImage(d, tmpFile("scan.tiff", 64));
    expect(addPendingImage).not.toHaveBeenCalled();
    expect(messages.join("\n")).toContain("Unsupported image type");
  });

  it("refuses an oversize file and reports its size against the cap", () => {
    // The cap must hold for the bytes READ, not only for the bytes kept — the
    // check used to run on the buffer after `readFileSync` had already pulled
    // the whole file in. Special files (size 0) keep the post-read backstop.
    const { messages, addPendingImage, deps: d } = deps();
    handleAttachImage(d, tmpFile("huge.png", IMAGE_MAX_BYTES + 1));
    expect(addPendingImage).not.toHaveBeenCalled();
    const out = messages.join("\n");
    expect(out).toContain("Image too large");
    expect(out).toContain(`max ${IMAGE_MAX_BYTES / (1024 * 1024)} MB`);
  });

  it("decides from stat alone — an oversize file is never read", () => {
    // Proves the ORDER, not just the outcome: size is checked before any read,
    // so a huge file can never allocate before the cap fires. node:fs is CJS,
    // so the imported object is the live module and the patch is visible to
    // the handler.
    const target = fs as { readFileSync: typeof fs.readFileSync };
    const { deps: d } = deps();
    const p = tmpFile("big.png", IMAGE_MAX_BYTES + 1);
    const original = target.readFileSync;
    const spy = vi.fn(original);
    target.readFileSync = spy as unknown as typeof fs.readFileSync;
    try {
      handleAttachImage(d, p);
    } finally {
      target.readFileSync = original;
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it("answers a missing file instead of throwing", () => {
    const { messages, addPendingImage, deps: d } = deps();
    handleAttachImage(d, path.join(os.tmpdir(), "anvil-does-not-exist-9f3.png"));
    expect(addPendingImage).not.toHaveBeenCalled();
    expect(messages.join("\n")).toContain("Could not read image");
  });
});
