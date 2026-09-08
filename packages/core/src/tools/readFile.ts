import fs from "node:fs/promises";
import { ToolContext, ToolDefinition, ToolExecutor } from "./types.js";
import { resolveWithinRoot } from "./paths.js";

// Large-file guard: reading a multi-megabyte file would blow the model's context.
const MAX_BYTES = 512 * 1024;

export const definition: ToolDefinition = {
  name: "read_file",
  description:
    "Read a text file from the project. Returns the content prefixed with cat -n style line " +
    "numbers (do NOT include these numbers when quoting file content in edit_file's old_str).",
  inputSchema: {
    type: "object",
    properties: { path: { type: "string", description: "Path relative to the project root" } },
    required: ["path"],
  },
  mutating: false,
};

export const execute: ToolExecutor = async (input, ctx: ToolContext) => {
  const { path: relPath } = (input ?? {}) as { path?: string };
  if (typeof relPath !== "string") {
    return {
      output: { error: "read_file requires a string argument: path" },
      isError: true,
      summary: "read_file failed: missing required path",
    };
  }
  const abs = resolveWithinRoot(ctx.projectRoot, relPath);
  // Open-then-fstat-then-bounded-read (the checkpoints.ts pattern): reading a
  // multi-GB file in full just to keep the first 512KB would spike the heap on
  // every accidental read of a log or artifact. The stat and the read observe
  // the same open file description, so the size check cannot be raced by a
  // concurrent writer (the old --readAll-then-slice had that TOCTOU).
  const fh = await fs.open(abs, "r"); // throws (ENOENT etc.) — executeTool wraps as isError
  let buf: Buffer;
  let totalBytes: number;
  let truncated: boolean;
  try {
    const stat = await fh.stat();
    totalBytes = stat.size;
    // Read at most MAX_BYTES; for larger files the size is known from stat, so
    // the rest is never materialized into memory.
    const toRead = Math.min(totalBytes, MAX_BYTES);
    const content = Buffer.alloc(toRead);
    const { bytesRead } = await fh.read(content, 0, toRead, 0);
    buf = bytesRead === toRead ? content : content.subarray(0, bytesRead);
    truncated = totalBytes > MAX_BYTES;
  } finally {
    await fh.close();
  }
  const text = buf.toString("utf8");
  const content = text
    .split("\n")
    .map((line, i) => `${String(i + 1).padStart(6)}\t${line}`)
    .join("\n");
  return {
    // totalBytes is the TRUE file size (from stat), so callers see how much was
    // truncated; content carries only the bounded head.
    output: { path: relPath, totalBytes, truncated, content },
    isError: false,
    summary: `Read ${relPath} (${totalBytes} bytes${truncated ? ", truncated" : ""})`,
  };
};
