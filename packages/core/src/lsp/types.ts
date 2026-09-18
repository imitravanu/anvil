/**
 * Phase 25.3 — LSP Integration types.
 * get_outline keeps its regex engine; LSP upgrades precision when a server is present.
 */

export type LspLanguage = "typescript" | "python" | "rust" | "go";

export interface LspServerCommand {
  language: LspLanguage;
  command: string;
  args: string[];
}

export interface LspPosition {
  line: number;
  character: number;
}

export interface LspLocation {
  path: string;
  line: number;
  character: number;
}

export interface LspDiagnostic {
  path: string;
  line: number;
  severity: "error" | "warning" | "info";
  message: string;
}

export interface LspClient {
  language: LspLanguage;
  /** Best-effort definition lookup; null when the server has no result. */
  gotoDefinition(path: string, position: LspPosition): Promise<LspLocation[]>;
  findReferences(path: string, position: LspPosition): Promise<LspLocation[]>;
  hover(path: string, position: LspPosition): Promise<string | null>;
  diagnostics(): Promise<LspDiagnostic[]>;
  close(): Promise<void>;
}
