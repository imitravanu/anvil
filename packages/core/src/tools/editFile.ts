import fs from "node:fs/promises";
import { createTwoFilesPatch } from "diff";
import { ToolContext, ToolDefinition, ToolExecutor } from "./types.js";
import { MAX_WRITE_BYTES } from "./writeFile.js";
import { resolveWithinRoot } from "./paths.js";
import { atomicWriteText } from "../atomicWrite.js";

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
  if (!input || typeof input.path !== "string" || typeof input.old_str !== "string" || typeof input.new_str !== "string") {
    throw new EditValidationError(
      "edit_file requires string arguments: path, old_str, new_str",
      "edit_file failed: missing or invalid required arguments (path, old_str, new_str)"
    );
  }
  const abs = resolveWithinRoot(ctx.projectRoot, input.path);
  // Same cap as read/write: editing a multi-megabyte file would blow the
  // model's context (and this read happens in describe(), pre-permission).
  const stat = await fs.stat(abs);
  if (stat.size > MAX_WRITE_BYTES) {
    throw new Error(`File exceeds the ${MAX_WRITE_BYTES}-byte edit limit (${stat.size} bytes).`);
  }
  const current = await fs.readFile(abs, "utf8");
  // Validate uniqueness BEFORE diffing: the preview used to render a
  // first-match diff for calls that execute() would then refuse as multi-match.
  const matches = countOccurrences(current, input.old_str);
  if (input.old_str === "" || matches === 0) {
    throw new EditValidationError("old_str not found in file", `edit_file failed: old_str not found in ${input.path}`);
  }
  if (matches > 1) {
    throw new EditValidationError(
      `old_str matches ${matches} times; it must match exactly once`,
      `edit_file failed: old_str matches ${matches} times in ${input.path}`
    );
  }
  const updated = current.replace(input.old_str, () => input.new_str);
  // new_str is model-supplied and unbounded: a legal source file plus a huge
  // replacement still writes far past the cap. The stat check above bounds only
  // the INPUT, so bound the RESULT here — before the diff allocates two copies.
  const updatedBytes = Buffer.byteLength(updated, "utf8");
  if (updatedBytes > MAX_WRITE_BYTES) {
    throw new EditValidationError(
      `Result would exceed the ${MAX_WRITE_BYTES}-byte edit limit (${updatedBytes} bytes)`,
      `edit_file failed: result exceeds ${MAX_WRITE_BYTES} bytes in ${input.path}`
    );
  }
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

/** Validation failures carry their exact user-facing output + summary. */
class EditValidationError extends Error {
  readonly summary: string;
  constructor(output: string, summary: string) {
    super(output);
    this.name = "EditValidationError";
    this.summary = summary;
  }
}

/** Count added/removed lines in a unified diff (skips +++/--- headers). Pure. */
function diffChurn(diff: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) added += 1;
    else if (line.startsWith("-") && !line.startsWith("---")) removed += 1;
  }
  return { added, removed };
}

export const execute: ToolExecutor = async (rawInput, ctx: ToolContext) => {
  const input = rawInput as EditInput;
  let result: Awaited<ReturnType<typeof computeEdit>>;
  try {
    result = await computeEdit(input, ctx);
  } catch (err) {
    if (err instanceof EditValidationError) {
      return { output: { error: err.message }, isError: true, summary: err.summary };
    }
    return {
      output: { error: (err as Error).message },
      isError: true,
      summary: `edit_file failed on ${input?.path ?? "file"}: ${(err as Error).message}`,
    };
  }
  await atomicWriteText(result.abs, result.updated, { signal: ctx.signal });
  const { added, removed } = diffChurn(result.diff);
  return {
    // The diff itself rides in output (visible via /expand); the card shows a
    // one-liner — the raw diff's first line was the "===" separator, which
    // rendered as "✓ edit_file ====…" in the transcript.
    output: { path: input.path, changed: true, added, removed, diff: result.diff },
    isError: false,
    summary: `Edited ${input.path} (+${added} −${removed})`,
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
