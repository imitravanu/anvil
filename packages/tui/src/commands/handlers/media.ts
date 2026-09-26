import fs from "node:fs";
import path from "node:path";
import { getErrorMessage } from "@anvil/core";
import type { CommandHandlerDeps } from "../types.js";
import { IMAGE_MAX_BYTES } from "../../util/displayLimits.js";
import { modelInfo } from "../../util/format.js";

const MEDIA_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

export interface StagedImage {
  mediaType: string;
  data: string;
  path: string;
  bytes: number;
}

export type ImageReadResult = { ok: true; image: StagedImage } | { ok: false; error: string };

/**
 * Read and validate an image path WITHOUT staging it. Shared by `/image` and
 * `/retry` (AUDIT-16): retry must re-attach the retried turn's images, and a
 * second copy of the size-before-read guard is how the two drift. Never throws
 * — a bad path is a message, not a crash.
 */
export function readImageForAttachment(rawPath: string): ImageReadResult {
  const p = rawPath.trim();
  if (!p) return { ok: false, error: "Usage: /image <path> — the image sends with your next message." };
  const mediaType = MEDIA_BY_EXT[path.extname(p).toLowerCase()];
  if (!mediaType) return { ok: false, error: "Unsupported image type — use png, jpeg, webp, or gif." };

  const tooLarge = (bytes: number): string =>
    `Image too large (${Math.ceil(bytes / 1024)} KB) — max ${IMAGE_MAX_BYTES / (1024 * 1024)} MB.`;

  try {
    // Check the SIZE BEFORE the read. Reading first and testing the buffer
    // afterward meant a 2 GB file (or /dev/zero) allocated unbounded memory
    // before the cap could fire, so the cap bounded nothing. Special files
    // report size 0 and still rely on the post-read check below.
    const size = fs.statSync(p).size;
    if (size > IMAGE_MAX_BYTES) return { ok: false, error: tooLarge(size) };
    const buf = fs.readFileSync(p);
    if (buf.length > IMAGE_MAX_BYTES) return { ok: false, error: tooLarge(buf.length) };
    return {
      ok: true,
      image: { mediaType, data: buf.toString("base64"), path: p, bytes: buf.length },
    };
  } catch (err: unknown) {
    return { ok: false, error: `Could not read image: ${getErrorMessage(err)}` };
  }
}

export function handleAttachImage(deps: CommandHandlerDeps, rawPath: string): void {
  const { isBusy, printSystemMessage, addPendingImage, currentModel, activeProviderId } = deps;
  if (isBusy) {
    printSystemMessage("Cannot attach images while a turn is in flight.");
    return;
  }
  const res = readImageForAttachment(rawPath);
  if (!res.ok) {
    printSystemMessage(res.error);
    return;
  }
  addPendingImage({ mediaType: res.image.mediaType, data: res.image.data, path: res.image.path });
  // Provider-qualified (AUDIT-02): the vision flag must come from THIS
  // provider's row, not another provider's same-named model.
  const supportsVision = modelInfo(currentModel, activeProviderId)?.supportsVision;
  const note = supportsVision === false ? " (note: this model may not support vision)" : "";
  printSystemMessage(
    `Image attached (${Math.ceil(res.image.bytes / 1024)} KB) — it sends with your next message.${note}`
  );
}
