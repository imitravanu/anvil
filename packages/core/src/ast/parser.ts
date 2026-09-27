import path from "node:path";
import type { AstSymbol, FileAst } from "./types.js";

/**
 * Determines language identifier from file extension.
 */
export function detectLanguage(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".ts":
    case ".tsx":
    case ".mts":
    case ".cts":
      return "typescript";
    case ".js":
    case ".jsx":
    case ".mjs":
    case ".cjs":
      return "javascript";
    case ".py":
    case ".pyw":
      return "python";
    case ".rs":
      return "rust";
    case ".go":
      return "go";
    default:
      return "unknown";
  }
}

/**
 * Parses a TypeScript or JavaScript source file into an AST symbol hierarchy.
 */
function parseTypeScriptJs(lines: string[]): AstSymbol[] {
  const symbols: AstSymbol[] = [];
  const total = lines.length;

  // Helper to extract preceding JSDoc comment
  function extractDocstring(idx: number): string | undefined {
    let cursor = idx - 1;
    while (cursor >= 0 && lines[cursor].trim() === "") {
      cursor--;
    }
    if (cursor >= 0 && lines[cursor].trim().endsWith("*/")) {
      const docLines: string[] = [];
      while (cursor >= 0) {
        const line = lines[cursor].trim();
        docLines.unshift(line);
        if (line.startsWith("/**") || line.startsWith("/*")) break;
        cursor--;
      }
      return docLines.join("\n");
    }
    return undefined;
  }

  // Find matching closing brace given an opening line index
  function findMatchingBrace(startIdx: number): { endIdx: number; bodyStart: number } | null {
    let depth = 0;
    let foundOpen = false;
    let bodyStart = -1;

    for (let i = startIdx; i < total; i++) {
      const line = lines[i];
      let inString: string | null = null;
      let inLineComment = false;

      for (let j = 0; j < line.length; j++) {
        const char = line[j];
        const next = line[j + 1];

        if (inLineComment) break;

        if (inString) {
          if (char === "\\") {
            j++; // Skip escaped char
          } else if (char === inString) {
            inString = null;
          }
          continue;
        }

        if (char === "/" && next === "/") {
          inLineComment = true;
          break;
        }

        if (char === '"' || char === "'" || char === "`") {
          inString = char;
          continue;
        }

        if (char === "{") {
          depth++;
          if (!foundOpen) {
            foundOpen = true;
            bodyStart = i + 2;
          }
        } else if (char === "}") {
          depth--;
          if (foundOpen && depth === 0) {
            return { endIdx: i, bodyStart };
          }
        }
      }
    }
    return null;
  }

  let i = 0;
  while (i < total) {
    const raw = lines[i];
    const trimmed = raw.trim();

    // Skip empty lines or comments
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) {
      i++;
      continue;
    }

    const isExported = trimmed.startsWith("export ") || trimmed.startsWith("export default ");
    const decl = isExported ? trimmed.replace(/^export\s+(default\s+)?/, "") : trimmed;

    // Interface definition
    const ifaceMatch = /^interface\s+([A-Za-z0-9_$]+)/.exec(decl);
    if (ifaceMatch) {
      const name = ifaceMatch[1];
      const brace = findMatchingBrace(i);
      const endLine = brace ? brace.endIdx + 1 : i + 1;
      symbols.push({
        name,
        kind: "interface",
        startLine: i + 1,
        endLine,
        signature: trimmed.split("{")[0]?.trim(),
        docstring: extractDocstring(i),
        bodyStartLine: brace?.bodyStart,
        bodyEndLine: brace ? brace.endIdx + 1 : undefined,
        isExported,
      });
      i = endLine;
      continue;
    }

    // Type alias definition
    const typeMatch = /^type\s+([A-Za-z0-9_$]+)/.exec(decl);
    if (typeMatch) {
      const name = typeMatch[1];
      let endIdx = i;
      while (endIdx < total && !lines[endIdx].includes(";")) {
        endIdx++;
      }
      const actualEnd = Math.min(endIdx, total - 1);
      symbols.push({
        name,
        kind: "type",
        startLine: i + 1,
        endLine: actualEnd + 1,
        signature: trimmed.split("=")[0]?.trim(),
        docstring: extractDocstring(i),
        isExported,
      });
      i = actualEnd + 1;
      continue;
    }

    // Enum definition
    const enumMatch = /^enum\s+([A-Za-z0-9_$]+)/.exec(decl);
    if (enumMatch) {
      const name = enumMatch[1];
      const brace = findMatchingBrace(i);
      const endLine = brace ? brace.endIdx + 1 : i + 1;
      symbols.push({
        name,
        kind: "enum",
        startLine: i + 1,
        endLine,
        signature: trimmed.split("{")[0]?.trim(),
        docstring: extractDocstring(i),
        bodyStartLine: brace?.bodyStart,
        bodyEndLine: brace ? brace.endIdx + 1 : undefined,
        isExported,
      });
      i = endLine;
      continue;
    }

    // Class definition
    const classMatch = /^(?:abstract\s+)?class\s+([A-Za-z0-9_$]+)/.exec(decl);
    if (classMatch) {
      const name = classMatch[1];
      const brace = findMatchingBrace(i);
      const endLine = brace ? brace.endIdx + 1 : i + 1;

      // Extract methods / properties inside the class
      const children: AstSymbol[] = [];
      if (brace && brace.bodyStart <= brace.endIdx) {
        let childIdx = brace.bodyStart; // 1-based line of start
        const innerEndIdx = brace.endIdx; // 0-based

        while (childIdx <= innerEndIdx) {
          const innerLine = lines[childIdx - 1]?.trim() ?? "";
          if (
            innerLine &&
            !innerLine.startsWith("//") &&
            !innerLine.startsWith("/*") &&
            !innerLine.startsWith("*")
          ) {
            // Method or constructor pattern
            const methodMatch =
              /^(?:public\s+|private\s+|protected\s+|static\s+|async\s+)*(constructor|[A-Za-z0-9_$]+)\s*(\([^{]*\))/.exec(
                innerLine
              );
            if (methodMatch) {
              const methodName = methodMatch[1];
              const methodBrace = findMatchingBrace(childIdx - 1);
              if (methodBrace) {
                children.push({
                  name: methodName,
                  kind: "method",
                  startLine: childIdx,
                  endLine: methodBrace.endIdx + 1,
                  signature: innerLine.split("{")[0]?.trim(),
                  docstring: extractDocstring(childIdx - 1),
                  bodyStartLine: methodBrace.bodyStart,
                  bodyEndLine: methodBrace.endIdx + 1,
                });
                childIdx = methodBrace.endIdx + 2;
                continue;
              }
            }
          }
          childIdx++;
        }
      }

      symbols.push({
        name,
        kind: "class",
        startLine: i + 1,
        endLine,
        signature: trimmed.split("{")[0]?.trim(),
        docstring: extractDocstring(i),
        bodyStartLine: brace?.bodyStart,
        bodyEndLine: brace ? brace.endIdx + 1 : undefined,
        children,
        isExported,
      });
      i = endLine;
      continue;
    }

    // Function definition
    const funcMatch = /^(?:async\s+)?function(?:\s*\*|\s+)\s*([A-Za-z0-9_$]+)/.exec(decl);
    if (funcMatch) {
      const name = funcMatch[1];
      const brace = findMatchingBrace(i);
      const endLine = brace ? brace.endIdx + 1 : i + 1;
      symbols.push({
        name,
        kind: "function",
        startLine: i + 1,
        endLine,
        signature: trimmed.split("{")[0]?.trim(),
        docstring: extractDocstring(i),
        bodyStartLine: brace?.bodyStart,
        bodyEndLine: brace ? brace.endIdx + 1 : undefined,
        isExported,
      });
      i = endLine;
      continue;
    }

    // Arrow function or const declaration: const foo = (...) => { ... }
    const arrowMatch = /^(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z0-9_$]+)\s*=>/.exec(
      decl
    );
    if (arrowMatch) {
      const name = arrowMatch[1];
      const brace = findMatchingBrace(i);
      if (brace) {
        const endLine = brace.endIdx + 1;
        symbols.push({
          name,
          kind: "function",
          startLine: i + 1,
          endLine,
          signature: trimmed.split("=>")[0]?.trim() + " =>",
          docstring: extractDocstring(i),
          bodyStartLine: brace.bodyStart,
          bodyEndLine: endLine,
          isExported,
        });
        i = endLine;
        continue;
      }
    }

    // Exported const/let/var variable
    if (isExported) {
      const varMatch = /^(?:const|let|var)\s+([A-Za-z0-9_$]+)/.exec(decl);
      if (varMatch) {
        const name = varMatch[1];
        symbols.push({
          name,
          kind: "constant",
          startLine: i + 1,
          endLine: i + 1,
          signature: trimmed,
          docstring: extractDocstring(i),
          isExported: true,
        });
      }
    }

    i++;
  }

  return symbols;
}

/**
 * Parses a Python source file based on indent block tracking.
 */
function parsePython(lines: string[]): AstSymbol[] {
  const symbols: AstSymbol[] = [];
  const total = lines.length;

  function getIndent(str: string): number {
    let count = 0;
    for (const ch of str) {
      if (ch === " ") count++;
      else if (ch === "\t") count += 4;
      else break;
    }
    return count;
  }

  function findBlockEnd(startIdx: number, baseIndent: number): number {
    let lastContent = startIdx;
    for (let k = startIdx + 1; k < total; k++) {
      const line = lines[k];
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const indent = getIndent(line);
      if (indent <= baseIndent) {
        return lastContent;
      }
      lastContent = k;
    }
    return lastContent;
  }

  let i = 0;
  while (i < total) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      i++;
      continue;
    }

    const indent = getIndent(raw);

    // Class definition
    const classMatch = /^class\s+([A-Za-z0-9_]+)/.exec(trimmed);
    if (classMatch) {
      const name = classMatch[1];
      const endIdx = findBlockEnd(i, indent);

      // Find methods inside class
      const children: AstSymbol[] = [];
      let mIdx = i + 1;
      while (mIdx <= endIdx) {
        const mRaw = lines[mIdx];
        const mTrimmed = mRaw.trim();
        const mIndent = getIndent(mRaw);

        if (mIndent > indent && (mTrimmed.startsWith("def ") || mTrimmed.startsWith("async def "))) {
          const methMatch = /^(?:async\s+)?def\s+([A-Za-z0-9_]+)/.exec(mTrimmed);
          if (methMatch) {
            const mName = methMatch[1];
            const mEnd = findBlockEnd(mIdx, mIndent);
            children.push({
              name: mName,
              kind: "method",
              startLine: mIdx + 1,
              endLine: mEnd + 1,
              signature: mTrimmed.split(":")[0]?.trim(),
              bodyStartLine: mIdx + 2,
              bodyEndLine: mEnd + 1,
            });
            mIdx = mEnd + 1;
            continue;
          }
        }
        mIdx++;
      }

      symbols.push({
        name,
        kind: "class",
        startLine: i + 1,
        endLine: endIdx + 1,
        signature: trimmed.split(":")[0]?.trim(),
        bodyStartLine: i + 2,
        bodyEndLine: endIdx + 1,
        children,
        isExported: !name.startsWith("_"),
      });
      i = endIdx + 1;
      continue;
    }

    // Function definition
    const funcMatch = /^(?:async\s+)?def\s+([A-Za-z0-9_]+)/.exec(trimmed);
    if (funcMatch) {
      const name = funcMatch[1];
      const endIdx = findBlockEnd(i, indent);
      symbols.push({
        name,
        kind: "function",
        startLine: i + 1,
        endLine: endIdx + 1,
        signature: trimmed.split(":")[0]?.trim(),
        bodyStartLine: i + 2,
        bodyEndLine: endIdx + 1,
        isExported: !name.startsWith("_"),
      });
      i = endIdx + 1;
      continue;
    }

    i++;
  }

  return symbols;
}

/**
 * Parses a Rust source file.
 */
function parseRust(lines: string[]): AstSymbol[] {
  const symbols: AstSymbol[] = [];
  const total = lines.length;

  function findMatchingBrace(startIdx: number): { endIdx: number; bodyStart: number } | null {
    let depth = 0;
    let foundOpen = false;
    let bodyStart = -1;

    for (let i = startIdx; i < total; i++) {
      const line = lines[i];
      for (let j = 0; j < line.length; j++) {
        const char = line[j];
        if (char === "{") {
          depth++;
          if (!foundOpen) {
            foundOpen = true;
            bodyStart = i + 1;
          }
        } else if (char === "}") {
          depth--;
          if (foundOpen && depth === 0) {
            return { endIdx: i, bodyStart };
          }
        }
      }
    }
    return null;
  }

  let i = 0;
  while (i < total) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith("//")) {
      i++;
      continue;
    }

    const isPub = trimmed.startsWith("pub ");
    const decl = isPub ? trimmed.replace(/^pub(?:\([^)]*\))?\s+/, "") : trimmed;

    // Struct
    const structMatch = /^struct\s+([A-Za-z0-9_]+)/.exec(decl);
    if (structMatch) {
      const name = structMatch[1];
      const brace = findMatchingBrace(i);
      const endLine = brace ? brace.endIdx + 1 : i + 1;
      symbols.push({
        name,
        kind: "struct",
        startLine: i + 1,
        endLine,
        signature: trimmed.split("{")[0]?.trim(),
        bodyStartLine: brace?.bodyStart,
        bodyEndLine: brace ? brace.endIdx + 1 : undefined,
        isExported: isPub,
      });
      i = endLine;
      continue;
    }

    // Trait
    const traitMatch = /^trait\s+([A-Za-z0-9_]+)/.exec(decl);
    if (traitMatch) {
      const name = traitMatch[1];
      const brace = findMatchingBrace(i);
      const endLine = brace ? brace.endIdx + 1 : i + 1;
      symbols.push({
        name,
        kind: "trait",
        startLine: i + 1,
        endLine,
        signature: trimmed.split("{")[0]?.trim(),
        bodyStartLine: brace?.bodyStart,
        bodyEndLine: brace ? brace.endIdx + 1 : undefined,
        isExported: isPub,
      });
      i = endLine;
      continue;
    }

    // Function
    const fnMatch = /^(?:async\s+)?fn\s+([A-Za-z0-9_]+)/.exec(decl);
    if (fnMatch) {
      const name = fnMatch[1];
      const brace = findMatchingBrace(i);
      const endLine = brace ? brace.endIdx + 1 : i + 1;
      symbols.push({
        name,
        kind: "function",
        startLine: i + 1,
        endLine,
        signature: trimmed.split("{")[0]?.trim(),
        bodyStartLine: brace?.bodyStart,
        bodyEndLine: brace ? brace.endIdx + 1 : undefined,
        isExported: isPub,
      });
      i = endLine;
      continue;
    }

    i++;
  }

  return symbols;
}

/**
 * Parses source code into a structured FileAst.
 */
export function parseFileAst(content: string, filePath: string): FileAst {
  const language = detectLanguage(filePath);
  const lines = content.split("\n");
  let symbols: AstSymbol[] = [];

  switch (language) {
    case "typescript":
    case "javascript":
      symbols = parseTypeScriptJs(lines);
      break;
    case "python":
      symbols = parsePython(lines);
      break;
    case "rust":
      symbols = parseRust(lines);
      break;
    default:
      // Fallback: simple line-based regex extraction
      symbols = parseTypeScriptJs(lines);
      break;
  }

  return {
    path: filePath,
    language,
    symbols,
    totalLines: lines.length,
  };
}
