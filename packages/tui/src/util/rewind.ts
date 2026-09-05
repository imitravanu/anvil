import type { CheckpointMeta } from "@anvil/core";
import { relativeTime } from "./format.js";

/** Rewind UI copy: list + restore results. Pure — App just prints them. */

export function formatRewindList(checkpoints: readonly CheckpointMeta[]): string {
  if (checkpoints.length === 0) {
    return "No checkpoints in this session yet. File writes snapshot automatically — shell commands can't be rewound.";
  }
  const lines = checkpoints.map(
    (c) =>
      `#${c.id}  ${c.files} file${c.files === 1 ? "" : "s"}  ·  ${relativeTime(c.ts)}` +
      (c.skipped > 0 ? `  [${c.skipped} skipped]` : "")
  );
  return [
    "Checkpoints (newest last) — /rewind <n> restores one:",
    ...lines,
    "Shell commands can't be rewound — only file writes.",
  ].join("\n");
}

export function formatRewindResult(result: {
  ok: boolean;
  restored: string[];
  deleted: string[];
  errors: string[];
  message: string;
}): string {
  const head = result.ok ? "✓ Rewound. " : "✗ Rewind failed. ";
  return head + result.message;
}
