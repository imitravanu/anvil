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
  /** Targets that changed on disk outside the session (optional for callers). */
  externallyModified?: string[];
  message: string;
}): string {
  const head = result.ok ? "✓ Rewound. " : "✗ Rewind failed. ";
  const changed = result.externallyModified ?? [];
  // Said out loud, but never as a failure: the restore still happened, and
  // whoever edited the file by hand deserves to hear that it was overwritten.
  const warning =
    changed.length > 0
      ? `\n⚠ ${changed.length} file${changed.length === 1 ? "" : "s"} changed on disk since this checkpoint ` +
        `(edited outside this session): ${changed.join(", ")}`
      : "";
  return head + result.message + warning;
}
