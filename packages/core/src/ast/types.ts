/**
 * Phase 30 — AST and Semantic Code Graph Data Types.
 * Represents structural symbol trees, declaration boundaries, and folding options.
 */

export type AstSymbolKind =
  | "function"
  | "method"
  | "class"
  | "interface"
  | "type"
  | "enum"
  | "variable"
  | "constant"
  | "struct"
  | "trait"
  | "impl"
  | "module";

export interface AstSymbol {
  name: string;
  kind: AstSymbolKind;
  startLine: number;
  endLine: number;
  signature?: string;
  docstring?: string;
  bodyStartLine?: number;
  bodyEndLine?: number;
  children?: AstSymbol[];
  isExported?: boolean;
}

export interface FileAst {
  path: string;
  language: string;
  symbols: AstSymbol[];
  totalLines: number;
}

export interface FoldOptions {
  /** Minimum body lines required to fold (default: 4). */
  minLinesToFold?: number;
  /** Keep docstrings when folding (default: true). */
  keepDocstrings?: boolean;
}
