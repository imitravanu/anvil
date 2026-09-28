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
 * Canonicalize a project-relative path to forward slashes so a file indexed
 * from the filesystem walk (`path.relative`, OS-native separators) and the
 * same file indexed from a tool call (model-supplied, usually `/`) collapse to
 * ONE key. Without this they diverge on Windows and the file is indexed twice
 * (a stale duplicate the later edit can never remove). Also drops a leading
 * `./` so `./src/a.ts` and `src/a.ts` are not two entries.
 */
function normalizePath(relPath: string): string {
  const unified = relPath.replace(/\\/g, "/");
  return unified.startsWith("./") ? unified.slice(2) : unified;
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
    const rel = normalizePath(relPath);
    this.removeFile(rel);

    const ast = parseFileAst(content, rel);
    const symbols: IndexedSymbol[] = [];

    const collect = (list: AstSymbol[]): void => {
      for (const s of list) {
        symbols.push({
          name: s.name,
          kind: s.kind,
          path: rel,
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
    this.fileSymbols.set(rel, symbols);

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
    const rel = normalizePath(relPath);
    const existing = this.fileSymbols.get(rel);
    if (!existing) return;

    for (const sym of existing) {
      const lower = sym.name.toLowerCase();
      const entries = this.symbolMap.get(lower);
      if (entries) {
        const filtered = entries.filter((e) => e.path !== rel);
        if (filtered.length > 0) {
          this.symbolMap.set(lower, filtered);
        } else {
          this.symbolMap.delete(lower);
        }
      }
    }
    this.fileSymbols.delete(rel);
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
            const rel = normalizePath(path.relative(this.projectRoot, full));
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
   *
   * Results are RANKED (exact name → prefix → substring) and then ordered
   * deterministically by name and path. The previous implementation returned
   * Map-insertion order, which for a filesystem build is `readdir` order — so
   * the same query produced a different ordering per machine and filesystem.
   * A symbol lookup an agent branches on must be stable.
   */
  public findSymbol(query: string, options: SymbolQueryOptions = {}): IndexedSymbol[] {
    const limit = options.limit ?? 25;
    const lowerQuery = query.toLowerCase().trim();
    if (lowerQuery.length === 0) return [];

    const scored: { entry: IndexedSymbol; score: number }[] = [];
    for (const [key, entries] of this.symbolMap.entries()) {
      // exact mode is the score-0 slice, so the same rank function serves both.
      if (!key.includes(lowerQuery)) continue;
      const score = key === lowerQuery ? 0 : key.startsWith(lowerQuery) ? 1 : 2;
      if (options.exact && score !== 0) continue;
      for (const entry of entries) {
        if (options.kind && entry.kind !== options.kind) continue;
        if (options.exportedOnly && !entry.isExported) continue;
        scored.push({ entry, score });
      }
    }

    scored.sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score;
      const byName = a.entry.name.toLowerCase().localeCompare(b.entry.name.toLowerCase());
      if (byName !== 0) return byName;
      return a.entry.path.localeCompare(b.entry.path);
    });

    return scored.slice(0, limit).map((m) => m.entry);
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
