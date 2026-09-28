import { ToolContext, ToolDefinition, ToolExecutor } from "./types.js";
import { WorkspaceSymbolIndex } from "../ast/symbolIndex.js";
import type { AstSymbolKind } from "../ast/types.js";

// Cache one WorkspaceSymbolIndex per projectRoot to avoid rescanning on every call
const indexCache = new Map<string, WorkspaceSymbolIndex>();

export function getProjectSymbolIndex(projectRoot: string): WorkspaceSymbolIndex {
  let idx = indexCache.get(projectRoot);
  if (!idx) {
    idx = new WorkspaceSymbolIndex(projectRoot);
    indexCache.set(projectRoot, idx);
  }
  return idx;
}

export const definition: ToolDefinition = {
  name: "find_symbol",
  description:
    "Search for functions, classes, interfaces, types, methods, and constants across the workspace symbol index. " +
    "Instant, token-efficient repository topology lookup without scanning entire files.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Symbol name or substring to search for" },
      exact: { type: "boolean", description: "Require exact name match (default: false)" },
      kind: {
        type: "string",
        enum: [
          "function",
          "method",
          "class",
          "interface",
          "type",
          "enum",
          "variable",
          "constant",
          "struct",
          "trait",
          "impl",
          "module",
        ],
        description: "Filter by symbol kind",
      },
    },
    required: ["query"],
  },
  mutating: false,
};

export const execute: ToolExecutor = async (input, ctx: ToolContext) => {
  const { query, exact = false, kind } = (input ?? {}) as {
    query?: string;
    exact?: boolean;
    kind?: AstSymbolKind;
  };

  if (typeof query !== "string" || !query.trim()) {
    return {
      output: { error: "find_symbol requires a non-empty string argument: query" },
      isError: true,
      summary: "find_symbol failed: missing query",
    };
  }

  const index = getProjectSymbolIndex(ctx.projectRoot);
  if (index.size === 0) {
    // Lazily build index if empty.
    await index.buildIndex();
  } else {
    // Editor saves, git checkout and run_command mutate files without touching
    // this index; validate so a lookup never answers from a stale world.
    await index.validateFreshness();
  }

  const matches = index.findSymbol(query, {
    exact,
    kind,
    limit: 25,
  });

  return {
    output: {
      query,
      count: matches.length,
      symbols: matches,
    },
    isError: false,
    summary: `Found ${matches.length} symbol${matches.length === 1 ? "" : "s"} matching '${query}'`,
  };
};
