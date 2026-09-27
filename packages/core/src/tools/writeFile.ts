import fs from "node:fs/promises";
import path from "node:path";
import { ToolContext, ToolDefinition, ToolExecutor } from "./types.js";
import { resolveWithinRoot } from "./paths.js";
import { atomicWriteText } from "../atomicWrite.js";
import { MAX_WRITE_BYTES } from "../config/constants.js";
import { getProjectSymbolIndex } from "./findSymbol.js";
import { checkPostMutationDiagnostics } from "../lsp/sensor.js";
import type { LspDiagnostic } from "../lsp/types.js";

export { MAX_WRITE_BYTES };

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
  const { path: relPath, content } = (input ?? {}) as { path?: string; content?: string };
  if (typeof relPath !== "string" || typeof content !== "string") {
    return {
      output: { error: "write_file requires string arguments: path, content" },
      isError: true,
      summary: "write_file failed: missing required arguments (path, content)",
    };
  }
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes > MAX_WRITE_BYTES) {
    return {
      output: { error: `Content exceeds the ${MAX_WRITE_BYTES}-byte write limit.` },
      isError: true,
      summary: `write_file failed: content exceeds ${MAX_WRITE_BYTES} bytes`,
    };
  }
  const abs = resolveWithinRoot(ctx.projectRoot, relPath);
  let existed = false;
  let prevBytes = 0;
  let prevMode: number | undefined;
  try {
    const stat = await fs.stat(abs);
    prevBytes = stat.size;
    // Preserve the executable bit (and friends) across overwrites — a plain
    // writeFile would reset scripts to 0644&~umask.
    prevMode = stat.mode & 0o777;
    existed = true;
  } catch {
    // new file
  }
  await atomicWriteText(abs, content, { mode: prevMode, signal: ctx.signal });

  // Invalidate / update symbol index for workspace topology
  try {
    const index = getProjectSymbolIndex(ctx.projectRoot);
    if (index.size > 0) {
      index.indexFile(relPath, content);
    }
  } catch {
    // Best-effort index update
  }

  // Check post-mutation compiler diagnostics (bounded to 400ms)
  let diagnostics: LspDiagnostic[] = [];
  try {
    diagnostics = await checkPostMutationDiagnostics(ctx.projectRoot, abs, content, 400);
  } catch {
    diagnostics = [];
  }

  const errors = diagnostics.filter((d) => d.severity === "error").length;
  const warnings = diagnostics.filter((d) => d.severity === "warning").length;
  let diagSummary = "";
  if (errors > 0) {
    diagSummary = ` · ⚠ ${errors} compiler error${errors > 1 ? "s" : ""}`;
  } else if (warnings > 0) {
    diagSummary = ` · ⚠ ${warnings} compiler warning${warnings > 1 ? "s" : ""}`;
  }

  return {
    output: {
      path: relPath,
      bytes,
      overwrote: existed,
      ...(diagnostics.length > 0 ? { diagnostics } : {}),
    },
    isError: false,
    summary: `${existed ? "Overwrote" : "Created"} ${relPath} (${bytes} bytes${existed ? `, was ${prevBytes}` : ""})${diagSummary}`,
  };
};

// Permission-prompt preview, computed WITHOUT writing. Capped: previewing a
// huge file must not drag megabytes into the prompt.
export const describe = async (input: unknown, ctx: ToolContext): Promise<string> => {
  const { path: relPath, content } = (input ?? {}) as { path?: string; content?: string };
  if (typeof relPath !== "string") {
    return "write_file (missing path)";
  }
  const bytes = Buffer.byteLength(content ?? "", "utf8");
  try {
    const abs = resolveWithinRoot(ctx.projectRoot, relPath);
    const stat = await fs.stat(abs);
    if (stat.size > MAX_WRITE_BYTES) {
      return `Overwrite ${relPath} (${bytes} bytes; current file exceeds the ${MAX_WRITE_BYTES}-byte edit limit and cannot be previewed fully)`;
    }
    const prev = await fs.readFile(abs, "utf8");
    return `Overwrite ${relPath} (${bytes} bytes, currently ${Buffer.byteLength(prev, "utf8")} bytes)`;
  } catch {
    return `Create ${relPath} (${bytes} bytes)`;
  }
};
