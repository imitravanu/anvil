import { parseFileAst } from "./parser.js";
import type { AstSymbol, FoldOptions } from "./types.js";

/**
 * Folds source code into a semantic skeleton, collapsing function and method
 * bodies that exceed `minLinesToFold` while preserving signatures, types,
 * interfaces, docstrings, and exact line number coordinates.
 */
export function generateSkeleton(
  content: string,
  filePath: string,
  options: FoldOptions = {}
): string {
  const minLines = options.minLinesToFold ?? 4;
  const ast = parseFileAst(content, filePath);
  const lines = content.split("\n");

  // Determine comment style based on language
  const isPython = ast.language === "python";
  const commentFormat = (foldedCount: number, startL: number, endL: number, indent: string): string => {
    if (isPython) {
      return `${indent}# ... ${foldedCount} lines folded (L${startL}-L${endL}) ...`;
    }
    return `${indent}/* ... ${foldedCount} lines folded (L${startL}-L${endL}) ... */`;
  };

  // Collect fold intervals: [startLine0, endLine0] (1-based, inclusive)
  interface FoldRange {
    start: number;
    end: number;
    indent: string;
  }
  const foldRanges: FoldRange[] = [];

  function collectRanges(symbols: AstSymbol[]): void {
    for (const sym of symbols) {
      // If symbol has children (e.g. class with methods), fold children individually
      if (sym.children && sym.children.length > 0) {
        collectRanges(sym.children);
      } else if (
        (sym.kind === "function" || sym.kind === "method") &&
        sym.bodyStartLine !== undefined &&
        sym.bodyEndLine !== undefined
      ) {
        // Only fold if inner body has at least minLines
        const start = sym.bodyStartLine;
        const end = isPython ? sym.bodyEndLine : sym.bodyEndLine - 1;
        const count = end - start + 1;
        if (count >= minLines && start <= end) {
          const firstBodyLine = lines[start - 1] ?? "";
          const indentMatch = firstBodyLine.match(/^(\s*)/);
          const indent = indentMatch ? indentMatch[1] : "  ";
          foldRanges.push({ start, end, indent });
        }
      }
    }
  }

  collectRanges(ast.symbols);

  // Sort fold ranges by start ascending
  foldRanges.sort((a, b) => a.start - b.start);

  const output: string[] = [];
  let currentLine = 1;

  for (const range of foldRanges) {
    // Write lines before fold
    while (currentLine < range.start && currentLine <= lines.length) {
      output.push(lines[currentLine - 1]);
      currentLine++;
    }

    // Write fold placeholder
    const foldedCount = range.end - range.start + 1;
    output.push(commentFormat(foldedCount, range.start, range.end, range.indent));
    currentLine = range.end + 1;
  }

  // Write remaining lines
  while (currentLine <= lines.length) {
    output.push(lines[currentLine - 1]);
    currentLine++;
  }

  return output.join("\n");
}
