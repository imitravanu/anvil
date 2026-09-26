import { getErrorMessage } from "../errors.js";
import { ToolContext, ToolDefinition, ToolExecutor } from "./types.js";
import { appendToMemory, MEMORY_RELATIVE_PATH } from "../config/memory.js";

export const definition: ToolDefinition = {
  name: "update_memory",
  description:
    "Record a note in the project memory for future sessions (writes .anvil/memory.md — requires permission). Use for: what was tried, where things live, conventions discovered.",
  inputSchema: {
    type: "object",
    properties: {
      entry: {
        type: "string",
        description: "The finding, architectural decision, or convention to preserve across sessions",
      },
    },
    required: ["entry"],
  },
  // AUDIT-01: this tool writes to the project (mkdir, .gitignore creation, and
  // a full-file rewrite when the 32KB cap is hit), so it MUST pass the same
  // trust boundary as write_file/edit_file. It was declared non-mutating in
  // Phase 19 to avoid prompting on every note; that saved prompts by letting an
  // ungated write happen — the tool-orchestrator keys both the permission
  // prompt and the serial/concurrent batch decision off `mutating`, and the
  // guardian only inspects calls carrying a `path` (this tool's input is
  // `entry`). Honest and noisy beats quiet and unprompted.
  mutating: true,
};

export const execute: ToolExecutor = async (input, ctx: ToolContext) => {
  const { entry } = (input ?? {}) as { entry?: string };
  if (typeof entry !== "string" || !entry.trim()) {
    return {
      output: { error: "update_memory requires a non-empty string argument: entry" },
      isError: true,
      summary: "update_memory failed: missing or empty entry",
    };
  }

  try {
    appendToMemory(ctx.projectRoot, entry.trim());
    return {
      output: {
        status: "recorded",
        path: MEMORY_RELATIVE_PATH,
        entry: entry.trim(),
      },
      isError: false,
      summary: "Recorded note in project memory (.anvil/memory.md)",
    };
  } catch (err) {
    return {
      output: { error: getErrorMessage(err) },
      isError: true,
      summary: `update_memory failed: ${getErrorMessage(err)}`,
    };
  }
};
