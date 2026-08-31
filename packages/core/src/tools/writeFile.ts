import fs from "node:fs/promises";
import path from "node:path";
import { ToolContext, ToolDefinition, ToolExecutor } from "./types.js";
import { resolveWithinRoot } from "./paths.js";

export const definition: ToolDefinition = {
  name: "write_file",
  description:
    "Create or overwrite a file with the given content. Parent directories are created as " +
    "needed. This is a mutating action — it requires permission.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path relative to the project root" },
      content: { type: "string", description: "Full file content to write" },
    },
    required: ["path", "content"],
  },
  mutating: true,
};

export const execute: ToolExecutor = async (input, ctx: ToolContext) => {
  const { path: relPath, content } = input as { path: string; content: string };
  const abs = resolveWithinRoot(ctx.projectRoot, relPath);
  let existed = false;
  let prevBytes = 0;
  try {
    prevBytes = (await fs.stat(abs)).size;
    existed = true;
  } catch {
    // new file
  }
  await fs.mkdir(path.dirname(abs), { recursive: true });
  if (ctx.signal.aborted) throw new Error("Aborted before writing");
  await fs.writeFile(abs, content, "utf8");
  const bytes = Buffer.byteLength(content, "utf8");
  return {
    output: { path: relPath, bytes, overwrote: existed },
    isError: false,
    summary: `${existed ? "Overwrote" : "Created"} ${relPath} (${bytes} bytes${existed ? `, was ${prevBytes}` : ""})`,
  };
};

// Permission-prompt preview, computed WITHOUT writing.
export const describe = async (input: unknown, ctx: ToolContext): Promise<string> => {
  const { path: relPath, content } = input as { path: string; content: string };
  const bytes = Buffer.byteLength(content ?? "", "utf8");
  try {
    const prev = await fs.readFile(resolveWithinRoot(ctx.projectRoot, relPath), "utf8");
    return `Overwrite ${relPath} (${bytes} bytes, currently ${Buffer.byteLength(prev, "utf8")} bytes)`;
  } catch {
    return `Create ${relPath} (${bytes} bytes)`;
  }
};
