import fs from "node:fs";
import path from "node:path";
import { MODEL_REGISTRY, getErrorMessage } from "@anvil/core";
import type { CommandHandlerDeps } from "../types.js";
import { IMAGE_MAX_BYTES } from "../../util/displayLimits.js";

export function handleAttachImage(deps: CommandHandlerDeps, rawPath: string): void {
  const { isBusy, printSystemMessage, addPendingImage, currentModel } = deps;
  if (isBusy) {
    printSystemMessage("Cannot attach images while a turn is in flight.");
    return;
  }
  const p = rawPath.trim();
  if (!p) {
    printSystemMessage("Usage: /image <path> — the image sends with your next message.");
    return;
  }
  const MEDIA_BY_EXT: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
  };
  const mediaType = MEDIA_BY_EXT[path.extname(p).toLowerCase()];
  if (!mediaType) {
    printSystemMessage("Unsupported image type — use png, jpeg, webp, or gif.");
    return;
  }
  try {
    const buf = fs.readFileSync(p);
    if (buf.length > IMAGE_MAX_BYTES) {
      printSystemMessage(`Image too large (${Math.ceil(buf.length / 1024)} KB) — max 5 MB.`);
      return;
    }
    addPendingImage({ mediaType, data: buf.toString("base64"), path: p });
    const supportsVision = MODEL_REGISTRY.find((m) => m.id === currentModel)?.supportsVision;
    const note = supportsVision === false ? " (note: this model may not support vision)" : "";
    printSystemMessage(
      `Image attached (${Math.ceil(buf.length / 1024)} KB) — it sends with your next message.${note}`
    );
  } catch (err: unknown) {
    printSystemMessage(`Could not read image: ${getErrorMessage(err)}`);
  }
}
