import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { handleAttachImage, readImageForAttachment } from "../handlers/media.js";
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
    // The cap holds before and during the read.
    const { messages, addPendingImage, deps: d } = deps();
    handleAttachImage(d, tmpFile("huge.png", IMAGE_MAX_BYTES + 1));
    expect(addPendingImage).not.toHaveBeenCalled();
    const out = messages.join("\n");
    expect(out).toContain("Image too large");
    expect(out).toContain(`max ${IMAGE_MAX_BYTES / (1024 * 1024)} MB`);
  });

  it("decides from fstat alone — an oversize file is never read", () => {
    const target = fs as { readSync: typeof fs.readSync };
    const p = tmpFile("big.png", IMAGE_MAX_BYTES + 1);
    const original = target.readSync;
    const spy = vi.fn(original);
    target.readSync = spy as unknown as typeof fs.readSync;
    try {
      readImageForAttachment(p);
    } finally {
      target.readSync = original;
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it("rejects special files before reading them", () => {
    if (process.platform !== "linux") return;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-media-"));
    tmp.push(dir);
    const target = path.join(dir, "zero.png");
    fs.symlinkSync("/dev/zero", target);
    const res = readImageForAttachment(target);
    expect(res).toEqual({ ok: false, error: "Image path must be a regular file." });
  });

  it("answers a missing file instead of throwing", () => {
    const { messages, addPendingImage, deps: d } = deps();
    handleAttachImage(d, path.join(os.tmpdir(), "anvil-does-not-exist-9f3.png"));
    expect(addPendingImage).not.toHaveBeenCalled();
    expect(messages.join("\n")).toContain("Could not read image");
  });
});
