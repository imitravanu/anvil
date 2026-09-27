import fs from "node:fs/promises";
import path from "node:path";
import { parseFileAst } from "./parser.js";
import type { AstSymbol, AstSymbolKind } from "./types.js";
import { EXCLUDED_DIRS } from "../tools/paths.js";

const CODE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".rs",
  ".go",
]);

export interface IndexedSymbol {
  name: string;
  kind: AstSymbolKind;
  path: string;
  line: number;
  signature?: string;
  docstring?: string;
  isExported?: boolean;
}

export interface SymbolQueryOptions {
  exact?: boolean;
  kind?: AstSymbolKind;
  exportedOnly?: boolean;
  limit?: number;
}

/**
 * In-memory symbol topology index mapping symbol names to file locations.
 * Enables microsecond cross-file symbol resolution across the monorepo.
 */
export class WorkspaceSymbolIndex {
  private fileSymbols: Map<string, IndexedSymbol[]> = new Map();
  private symbolMap: Map<string, IndexedSymbol[]> = new Map();
  private projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  /**
   * Indexes a single file into the symbol tables.
   */
  public indexFile(relPath: string, content: string): void {
    this.removeFile(relPath);

    const ast = parseFileAst(content, relPath);
    const symbols: IndexedSymbol[] = [];

    const collect = (list: AstSymbol[]): void => {
      for (const s of list) {
        symbols.push({
          name: s.name,
          kind: s.kind,
          path: relPath,
          line: s.startLine,
          signature: s.signature,
          docstring: s.docstring,
          isExported: s.isExported,
        });
        if (s.children) {
          collect(s.children);
        }
      }
    };

    collect(ast.symbols);
    this.fileSymbols.set(relPath, symbols);

    for (const sym of symbols) {
      const lower = sym.name.toLowerCase();
      let entries = this.symbolMap.get(lower);
      if (!entries) {
        entries = [];
        this.symbolMap.set(lower, entries);
      }
      entries.push(sym);
    }
  }

  /**
   * Removes a file from the symbol index.
   */
  public removeFile(relPath: string): void {
    const existing = this.fileSymbols.get(relPath);
    if (!existing) return;

    for (const sym of existing) {
      const lower = sym.name.toLowerCase();
      const entries = this.symbolMap.get(lower);
      if (entries) {
        const filtered = entries.filter((e) => e.path !== relPath);
        if (filtered.length > 0) {
          this.symbolMap.set(lower, filtered);
        } else {
          this.symbolMap.delete(lower);
        }
      }
    }
    this.fileSymbols.delete(relPath);
  }

  /**
   * Scans and indexes the entire workspace directory recursively.
   */
  public async buildIndex(): Promise<number> {
    this.fileSymbols.clear();
    this.symbolMap.clear();

    let count = 0;
    const walk = async (dir: string): Promise<void> => {
      const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (EXCLUDED_DIRS.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (CODE_EXTENSIONS.has(ext)) {
            const rel = path.relative(this.projectRoot, full);
            const content = await fs.readFile(full, "utf8").catch(() => "");
            if (content) {
              this.indexFile(rel, content);
              count++;
            }
          }
        }
      }
    };

    await walk(this.projectRoot);
    return count;
  }

  /**
   * Searches the workspace symbol table.
   */
  public findSymbol(query: string, options: SymbolQueryOptions = {}): IndexedSymbol[] {
    const limit = options.limit ?? 25;
    const lowerQuery = query.toLowerCase().trim();
    const results: IndexedSymbol[] = [];

    if (options.exact) {
      const exactMatches = this.symbolMap.get(lowerQuery) ?? [];
      for (const match of exactMatches) {
        if (options.kind && match.kind !== options.kind) continue;
        if (options.exportedOnly && !match.isExported) continue;
        results.push(match);
        if (results.length >= limit) break;
      }
      return results;
    }

    // Substring / fuzzy prefix matches
    for (const [key, entries] of this.symbolMap.entries()) {
      if (key.includes(lowerQuery)) {
        for (const entry of entries) {
          if (options.kind && entry.kind !== options.kind) continue;
          if (options.exportedOnly && !entry.isExported) continue;
          results.push(entry);
          if (results.length >= limit) return results;
        }
      }
    }

    return results;
  }

  /** Total symbols indexed across workspace. */
  public get size(): number {
    let total = 0;
    for (const syms of this.fileSymbols.values()) {
      total += syms.length;
    }
    return total;
  }
}
