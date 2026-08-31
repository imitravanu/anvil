import fs from "node:fs/promises";
import { createTwoFilesPatch } from "diff";
import { ToolContext, ToolDefinition, ToolExecutor } from "./types.js";
import { resolveWithinRoot } from "./paths.js";

interface EditInput {
  path: string;
  old_str: string;
  new_str: string;
}

export const definition: ToolDefinition = {
  name: "edit_file",
  description:
    "Replace an exact, unique substring (old_str) in a file with new_str. old_str must match " +
    "exactly once. Do NOT include line numbers from read_file output in old_str.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path relative to the project root" },
      old_str: { type: "string", description: "Exact existing text to replace" },
      new_str: { type: "string", description: "Replacement text" },
    },
    required: ["path", "old_str", "new_str"],
  },
  mutating: true,
};

function countOccurrences(haystack: string, needle: string): number {
  if (needle === "") return 0;
  return haystack.split(needle).length - 1;
}

async function computeEdit(
  input: EditInput,
  ctx: ToolContext
): Promise<{ abs: string; current: string; updated: string; diff: string }> {
  const abs = resolveWithinRoot(ctx.projectRoot, input.path);
  const current = await fs.readFile(abs, "utf8");
  const updated = current.replace(input.old_str, () => input.new_str);
  const diff = createTwoFilesPatch(
    `a/${input.path}`,
    `b/${input.path}`,
    current,
    updated,
    undefined,
    undefined,
    { context: 3 }
  );
  return { abs, current, updated, diff };
}

export const execute: ToolExecutor = async (rawInput, ctx: ToolContext) => {
  const input = rawInput as EditInput;
  let result: Awaited<ReturnType<typeof computeEdit>>;
  try {
    result = await computeEdit(input, ctx);
  } catch (err) {
    return {
      output: { error: (err as Error).message },
      isError: true,
      summary: `edit_file failed on ${input.path}: ${(err as Error).message}`,
    };
  }
  const matches = countOccurrences(result.current, input.old_str);
  if (input.old_str === "" || matches === 0) {
    return {
      output: { error: "old_str not found in file" },
      isError: true,
      summary: `edit_file failed: old_str not found in ${input.path}`,
    };
  }
  if (matches > 1) {
    return {
      output: { error: `old_str matches ${matches} times; it must match exactly once` },
      isError: true,
      summary: `edit_file failed: old_str matches ${matches} times in ${input.path}`,
    };
  }
  if (ctx.signal.aborted) throw new Error("Aborted before writing");
  await fs.writeFile(result.abs, result.updated, "utf8");
  return {
    output: { path: input.path, changed: true },
    isError: false,
    // Real unified diff — this is what the Phase 4 permission prompt renders.
    summary: result.diff,
  };
};

// Permission-prompt preview: the actual unified diff, computed WITHOUT writing.
export const describe = async (rawInput: unknown, ctx: ToolContext): Promise<string> => {
  const input = rawInput as EditInput;
  try {
    const { diff } = await computeEdit(input, ctx);
    return diff;
  } catch (err) {
    return `Edit ${input.path} (preview unavailable: ${(err as Error).message})`;
  }
};
