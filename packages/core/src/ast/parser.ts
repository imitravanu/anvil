import path from "node:path";
import type { AstSymbol, AstSymbolKind, FileAst } from "./types.js";

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
 * Marks each line as holding live code (true) or as living inside a comment or a
 * multi-line template literal (false).
 *
 * One scan keeps that state ACROSS lines, which the line-local
 * `trimmed.startsWith("/*")` check it replaces could not: a comment's first and
 * last line were skipped but its interior was not, so commented-out code was
 * indexed as real symbols and `find_symbol` returned functions that do not
 * exist. The same mask feeds brace matching, so a `{` inside a comment or a
 * template literal can no longer desynchronise the scanner and swallow every
 * declaration after it.
 */
function buildCodeLineMask(
  lines: string[],
  options: { rustRawStrings?: boolean } = {}
): boolean[] {
  const mask = new Array<boolean>(lines.length).fill(true);
  let inBlockComment = false;
  let inTemplate = false;
  // Rust raw strings have no escapes and can span lines, so the closing `"#`
  // sequence has to be carried across lines the way block comments are.
  let inRawString: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let hasCode = false;
    let j = 0;

    while (j < line.length) {
      const char = line[j];
      const next = line[j + 1];

      if (inRawString) {
        const closer = inRawString;
        const close = line.indexOf(closer, j);
        if (close === -1) break;
        inRawString = null;
        j = close + closer.length;
        continue;
      }

      if (inBlockComment) {
        const close = line.indexOf("*/", j);
        if (close === -1) break;
        inBlockComment = false;
        j = close + 2;
        continue;
      }

      if (options.rustRawStrings && char === "r") {
        const opener = /^r(#+)?"/.exec(line.slice(j));
        if (opener) {
          const closer = `"${opener[1] ?? ""}`;
          hasCode = true;
          const close = line.indexOf(closer, j + opener[0].length);
          if (close === -1) {
            inRawString = closer;
            break;
          }
          j = close + closer.length;
          continue;
        }
      }

      if (inTemplate) {
        // Template contents are data: a `/*` in here must not open a comment.
        if (char === "\\") {
          j += 2;
          continue;
        }
        if (char === "`") {
          inTemplate = false;
          hasCode = true;
        }
        j++;
        continue;
      }

      if (char === "/" && next === "/") break;
      if (char === "/" && next === "*") {
        inBlockComment = true;
        j += 2;
        continue;
      }

      if (char === "`") {
        inTemplate = true;
        hasCode = true;
        j++;
        continue;
      }

      if (char === '"' || char === "'") {
        // Skip the literal so quotes and comment markers inside it are inert.
        hasCode = true;
        j++;
        while (j < line.length) {
          if (line[j] === "\\") {
            j += 2;
            continue;
          }
          if (line[j] === char) break;
          j++;
        }
        j++;
        continue;
      }

      if (char !== " " && char !== "\t") hasCode = true;
      j++;
    }

    mask[i] = hasCode;
  }

  return mask;
}

/**
 * Length of the string literal starting at `j`, or 0 if the character there does
 * not open one.
 *
 * The Rust and Go brace scanners counted every brace on a line, so `let s = "{";`
 * left depth permanently unbalanced: the declaration's real closing brace never
 * brought it back to zero, the scan returned null, and the symbol's line range
 * collapsed to a single line — wrong `read_file` folds and wrong `find_symbol`
 * coordinates for any function holding a brace in a string. The TypeScript
 * scanner already skipped literals; Rust and Go did not.
 *
 * An unterminated literal skips to end of line; multi-line literals are handled
 * by `buildCodeLineMask`, which carries raw-string and template state across
 * lines (Go backticks, Rust `r#"…"#`).
 */
function stringLiteralLength(line: string, j: number): number {
  const char = line[j];

  // Rust raw string: r"…", r#"…"#, r##"…"##
  if (char === "r" && (line[j + 1] === '"' || line[j + 1] === "#")) {
    const opener = /^r(#+)?"/.exec(line.slice(j));
    if (opener) {
      const closer = `"${opener[1] ?? ""}`;
      const close = line.indexOf(closer, j + opener[0].length);
      return close === -1 ? line.length - j : close + closer.length - j;
    }
  }

  if (char === '"') {
    let k = j + 1;
    while (k < line.length) {
      if (line[k] === "\\") {
        k += 2;
        continue;
      }
      if (line[k] === '"') return k + 1 - j;
      k++;
    }
    return line.length - j;
  }

  // Rust char literal, matched precisely so a lifetime (`&'a str`) is not
  // mistaken for one — a bare `'` search would swallow everything to the next
  // apostrophe and hide real braces.
  if (char === "'") {
    const literal = /^'(?:\\.|[^'\\])'/.exec(line.slice(j));
    if (literal) return literal[0].length;
  }

  return 0;
}

/**
 * Re-bases symbol line numbers after parsing a slice of a file, so recursively
 * parsed declarations keep file-absolute coordinates rather than slice-relative
 * ones (which would point at the wrong lines in `read_file` and `find_symbol`).
 */
function shiftLines(symbols: AstSymbol[], delta: number): AstSymbol[] {
  return symbols.map((s) => ({
    ...s,
    startLine: s.startLine + delta,
    endLine: s.endLine + delta,
    bodyStartLine: s.bodyStartLine === undefined ? undefined : s.bodyStartLine + delta,
    bodyEndLine: s.bodyEndLine === undefined ? undefined : s.bodyEndLine + delta,
    children: s.children ? shiftLines(s.children, delta) : undefined,
  }));
}

/**
 * Parses a TypeScript or JavaScript source file into an AST symbol hierarchy.
 */
function parseTypeScriptJs(lines: string[]): AstSymbol[] {
  const symbols: AstSymbol[] = [];
  const total = lines.length;
  const codeLines = buildCodeLineMask(lines);

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
      // A line inside a comment or a multi-line template literal is data, not
      // syntax — counting its braces is what lost every symbol after a
      // CSS-in-JS block or a commented-out function.
      if (!codeLines[i]) continue;
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

    // Skip empty lines and lines that live entirely inside a comment.
    if (!trimmed || !codeLines[i]) {
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

    // Enum definition. Members are indexed as `constant` children: `Color.Red`
    // is a real thing to search for and was previously invisible.
    const enumMatch = /^enum\s+([A-Za-z0-9_$]+)/.exec(decl);
    if (enumMatch) {
      const name = enumMatch[1];
      const brace = findMatchingBrace(i);
      const endLine = brace ? brace.endIdx + 1 : i + 1;

      const members: AstSymbol[] = [];
      if (brace) {
        for (let k = brace.bodyStart - 1; k <= brace.endIdx; k++) {
          if (!codeLines[k]) continue;
          const memberLine = lines[k].trim();
          const memberMatch = /^([A-Za-z0-9_$]+|"[^"]+"|'[^']+')\s*(?:=|,|$)/.exec(memberLine);
          if (memberMatch) {
            members.push({
              name: memberMatch[1].replace(/^["']|["']$/g, ""),
              kind: "constant",
              startLine: k + 1,
              endLine: k + 1,
              signature: memberLine.replace(/,\s*$/, ""),
              isExported,
            });
          }
        }
      }

      symbols.push({
        name,
        kind: "enum",
        startLine: i + 1,
        endLine,
        signature: trimmed.split("{")[0]?.trim(),
        docstring: extractDocstring(i),
        bodyStartLine: brace?.bodyStart,
        bodyEndLine: brace ? brace.endIdx + 1 : undefined,
        children: members.length > 0 ? members : undefined,
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
          if (innerLine && codeLines[childIdx - 1]) {
            // Method or constructor pattern
            const methodMatch =
              /^(?:public\s+|private\s+|protected\s+|static\s+|async\s+|abstract\s+|override\s+|declare\s+)*(constructor|[A-Za-z0-9_$]+)\s*(\([^{]*\))/.exec(
                innerLine
              );
            if (methodMatch) {
              const methodName = methodMatch[1];
              // An abstract/declared method ends in `;` and has no body. Scanning
              // ahead for a brace would adopt the NEXT method's body and drop it.
              const signatureOnly = innerLine.trimEnd().endsWith(";");
              const methodBrace = signatureOnly ? null : findMatchingBrace(childIdx - 1);
              if (methodBrace || signatureOnly) {
                children.push({
                  name: methodName,
                  kind: "method",
                  startLine: childIdx,
                  endLine: methodBrace ? methodBrace.endIdx + 1 : childIdx,
                  signature: (innerLine.split("{")[0] ?? "").replace(/;\s*$/, "").trim(),
                  docstring: extractDocstring(childIdx - 1),
                  bodyStartLine: methodBrace?.bodyStart,
                  bodyEndLine: methodBrace ? methodBrace.endIdx + 1 : undefined,
                });
                childIdx = methodBrace ? methodBrace.endIdx + 2 : childIdx + 1;
                continue;
              }
            }

            // Arrow-function class property: `onClick = () => { … }`. The method
            // pattern above demands `name(`, so every callable class property was
            // invisible — a pattern modern TypeScript uses constantly. Plain data
            // fields are deliberately NOT indexed here: they are values, not
            // declarations an agent looks up by name, and indexing them would
            // flood the symbol table.
            const arrowPropMatch =
              /^(?:public\s+|private\s+|protected\s+|static\s+|readonly\s+|async\s+|declare\s+|abstract\s+|override\s+)*([A-Za-z0-9_$]+)\s*(?:[!:][\s\S]*?)?=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z0-9_$]+)\s*(?::[^=]*)?=>/.exec(
                innerLine
              );
            if (arrowPropMatch) {
              // Only a `{` after the arrow opens a body. `(e) => this.log(e);` is a
              // complete single-line expression, and scanning ahead for a brace
              // would adopt the next method's body and drop it from the index.
              const afterArrow = innerLine.slice(arrowPropMatch[0].length);
              const propBrace = afterArrow.includes("{") ? findMatchingBrace(childIdx - 1) : null;
              children.push({
                name: arrowPropMatch[1],
                kind: "method",
                startLine: childIdx,
                endLine: propBrace ? propBrace.endIdx + 1 : childIdx,
                signature: `${innerLine.split("=>")[0]?.trim()} =>`,
                docstring: extractDocstring(childIdx - 1),
                bodyStartLine: propBrace?.bodyStart,
                bodyEndLine: propBrace ? propBrace.endIdx + 1 : undefined,
              });
              childIdx = propBrace ? propBrace.endIdx + 2 : childIdx + 1;
              continue;
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
 * Marks each line of a Python file as code (true) or as living inside a `#`
 * comment or a triple-quoted string (false).
 *
 * Python's docstrings and multi-line string literals are the Python form of the
 * comment-interior defect: an example inside a module docstring or a template
 * assigned to a constant was extracted as a real symbol, so `find_symbol`
 * returned a function or class the file never defines. `#` comments were already
 * handled; the triple-quoted forms were not.
 */
function buildPythonCodeLineMask(lines: string[]): boolean[] {
  const mask = new Array<boolean>(lines.length).fill(true);
  let inTriple: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let hasCode = false;
    let j = 0;

    while (j < line.length) {
      const char = line[j];

      if (inTriple) {
        const close = line.indexOf(inTriple, j);
        if (close === -1) break;
        inTriple = null;
        j = close + 3;
        continue;
      }

      if (char === "#") break;

      const triple = line.slice(j, j + 3);
      if (triple === '\"\"\"' || triple === "'''") {
        inTriple = triple;
        j += 3;
        continue;
      }

      if (char === '"' || char === "'") {
        hasCode = true;
        j++;
        while (j < line.length) {
          if (line[j] === "\\") {
            j += 2;
            continue;
          }
          if (line[j] === char) break;
          j++;
        }
        j++;
        continue;
      }

      if (char !== " " && char !== "\t") hasCode = true;
      j++;
    }

    mask[i] = hasCode;
  }

  return mask;
}

/**
 * Parses a Python source file based on indent block tracking.
 */
function parsePython(lines: string[]): AstSymbol[] {
  const symbols: AstSymbol[] = [];
  const total = lines.length;
  const codeLines = buildPythonCodeLineMask(lines);

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
      if (!trimmed || !codeLines[k]) continue;
      const indent = getIndent(line);
      if (indent <= baseIndent) {
        return lastContent;
      }
      lastContent = k;
    }
    return lastContent;
  }

  /**
   * Collects a class body's members: methods, and nested classes (which recurse).
   * A nested class used to fall into the `mIdx++` path and was then skipped
   * wholesale by the outer loop's `i = endIdx + 1`, so it was absent from the
   * index even though nested class declarations are routine in Python.
   */
  function collectClassMembers(classIndent: number, bodyStart: number, bodyEnd: number): AstSymbol[] {
    const members: AstSymbol[] = [];
    let mIdx = bodyStart;
    while (mIdx <= bodyEnd) {
      const mRaw = lines[mIdx];
      const mTrimmed = mRaw.trim();
      const mIndent = getIndent(mRaw);

      if (mIndent <= classIndent || !codeLines[mIdx]) {
        mIdx++;
        continue;
      }

      const nestedClass = /^class\s+([A-Za-z0-9_]+)/.exec(mTrimmed);
      if (nestedClass) {
        const nName = nestedClass[1];
        const nEnd = findBlockEnd(mIdx, mIndent);
        members.push({
          name: nName,
          kind: "class",
          startLine: mIdx + 1,
          endLine: nEnd + 1,
          signature: mTrimmed.split(":")[0]?.trim(),
          bodyStartLine: mIdx + 2,
          bodyEndLine: nEnd + 1,
          children: collectClassMembers(mIndent, mIdx + 1, nEnd),
          isExported: !nName.startsWith("_"),
        });
        mIdx = nEnd + 1;
        continue;
      }

      const methMatch = /^(?:async\s+)?def\s+([A-Za-z0-9_]+)/.exec(mTrimmed);
      if (methMatch) {
        const mEnd = findBlockEnd(mIdx, mIndent);
        members.push({
          name: methMatch[1],
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

      mIdx++;
    }
    return members;
  }

  let i = 0;
  while (i < total) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (!trimmed || !codeLines[i]) {
      i++;
      continue;
    }

    const indent = getIndent(raw);

    // Class definition
    const classMatch = /^class\s+([A-Za-z0-9_]+)/.exec(trimmed);
    if (classMatch) {
      const name = classMatch[1];
      const endIdx = findBlockEnd(i, indent);

      const children = collectClassMembers(indent, i + 1, endIdx);

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
  const codeLines = buildCodeLineMask(lines, { rustRawStrings: true });

  function findMatchingBrace(startIdx: number): { endIdx: number; bodyStart: number } | null {
    let depth = 0;
    let foundOpen = false;
    let bodyStart = -1;

    for (let i = startIdx; i < total; i++) {
      if (!codeLines[i]) continue;
      const line = lines[i];
      for (let j = 0; j < line.length; j++) {
        const literalLength = stringLiteralLength(line, j);
        if (literalLength > 0) {
          j += literalLength - 1;
          continue;
        }
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

  /**
   * Collects `fn` declarations inside a braced body as `method` children.
   *
   * A trait method is usually just a signature ending in `;`, so a missing brace
   * is normal and must not abort the scan (or the pass would stop at the first
   * signature). `bounded` also refuses a brace that closes past the container,
   * which keeps a malformed body from swallowing the rest of the file.
   */
  function collectFnMethods(bodyStart: number, bodyEnd: number): AstSymbol[] {
    const methods: AstSymbol[] = [];
    let k = bodyStart;
    while (k <= bodyEnd) {
      const line = lines[k].trim();
      if (codeLines[k] && line) {
        const innerPub = line.startsWith("pub ");
        const innerDecl = innerPub ? line.replace(/^pub(?:\([^)]*\))?\s+/, "") : line;
        const methodMatch = /^(?:async\s+)?fn\s+([A-Za-z0-9_]+)/.exec(innerDecl);
        if (methodMatch) {
          // A trait signature ends in `;` and has no body. Without this check the
          // scanner would treat the NEXT method's braces as its body, consume
          // them, and drop every method after the first signature-only one.
          const signatureOnly = (line.split("{")[0] ?? "").trimEnd().endsWith(";");
          const methodBrace = signatureOnly ? null : findMatchingBrace(k);
          const bounded = methodBrace !== null && methodBrace.endIdx <= bodyEnd;
          methods.push({
            name: methodMatch[1],
            kind: "method",
            startLine: k + 1,
            endLine: bounded && methodBrace ? methodBrace.endIdx + 1 : k + 1,
            signature: (line.split("{")[0] ?? "").replace(/;\s*$/, "").trim(),
            bodyStartLine: bounded ? methodBrace?.bodyStart : undefined,
            bodyEndLine: bounded && methodBrace ? methodBrace.endIdx + 1 : undefined,
            isExported: innerPub,
          });
          k = bounded && methodBrace ? methodBrace.endIdx + 1 : k + 1;
          continue;
        }
      }
      k++;
    }
    return methods;
  }

  /**
   * Collects enum variants, including those with tuple or struct payloads.
   * Depth is tracked so a struct variant's own fields are not mistaken for
   * further variants (`E::C { x: u32 }` must yield `C`, not `x`).
   */
  function collectEnumVariants(bodyStart: number, bodyEnd: number, exported: boolean): AstSymbol[] {
    const variants: AstSymbol[] = [];
    let depth = 0;
    for (let k = bodyStart; k <= bodyEnd; k++) {
      const line = lines[k].trim();
      if (line && codeLines[k] && depth === 0 && !line.startsWith("#[")) {
        const variantMatch = /^([A-Za-z0-9_]+)/.exec(line);
        if (variantMatch) {
          variants.push({
            name: variantMatch[1],
            kind: "constant",
            startLine: k + 1,
            endLine: k + 1,
            signature: line.replace(/,\s*$/, ""),
            isExported: exported,
          });
        }
      }
      for (const ch of line) {
        if (ch === "{") depth++;
        else if (ch === "}") depth--;
      }
    }
    return variants;
  }

  let i = 0;
  while (i < total) {
    const trimmed = lines[i].trim();
    if (!trimmed || !codeLines[i]) {
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

    // Trait — its methods are the interface an agent searches for by name.
    const traitMatch = /^trait\s+([A-Za-z0-9_]+)/.exec(decl);
    if (traitMatch) {
      const name = traitMatch[1];
      const brace = findMatchingBrace(i);
      const endLine = brace ? brace.endIdx + 1 : i + 1;
      const children = brace ? collectFnMethods(i + 1, brace.endIdx) : [];
      symbols.push({
        name,
        kind: "trait",
        startLine: i + 1,
        endLine,
        signature: trimmed.split("{")[0]?.trim(),
        bodyStartLine: brace?.bodyStart,
        bodyEndLine: brace ? brace.endIdx + 1 : undefined,
        children: children.length > 0 ? children : undefined,
        isExported: isPub,
      });
      i = endLine;
      continue;
    }

    // Enum — variants are indexed so `Mode::Fast` is findable by name.
    const enumMatch = /^enum\s+([A-Za-z0-9_]+)/.exec(decl);
    if (enumMatch) {
      const name = enumMatch[1];
      const brace = findMatchingBrace(i);
      const endLine = brace ? brace.endIdx + 1 : i + 1;
      const variants = brace ? collectEnumVariants(i + 1, brace.endIdx, isPub) : [];
      symbols.push({
        name,
        kind: "enum",
        startLine: i + 1,
        endLine,
        signature: trimmed.split("{")[0]?.trim(),
        bodyStartLine: brace?.bodyStart,
        bodyEndLine: brace ? brace.endIdx + 1 : undefined,
        children: variants.length > 0 ? variants : undefined,
        isExported: isPub,
      });
      i = endLine;
      continue;
    }

    // Union (a braced record type, same shape as a struct)
    const unionMatch = /^union\s+([A-Za-z0-9_]+)/.exec(decl);
    if (unionMatch) {
      const name = unionMatch[1];
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

    // Module — `mod m { … }` nests its contents; `mod m;` is a single line.
    // The body is parsed recursively and re-based so `find_symbol` still reaches
    // nested functions (the index flattens children) instead of promoting them
    // to file-level declarations with a wrong parent.
    const modMatch = /^mod\s+([A-Za-z0-9_]+)/.exec(decl);
    if (modMatch) {
      const name = modMatch[1];
      const brace = findMatchingBrace(i);
      const endLine = brace ? brace.endIdx + 1 : i + 1;
      const children = brace
        ? shiftLines(parseRust(lines.slice(i + 1, brace.endIdx)), i + 1)
        : undefined;
      symbols.push({
        name,
        kind: "module",
        startLine: i + 1,
        endLine,
        signature: trimmed.split("{")[0]?.trim(),
        bodyStartLine: brace?.bodyStart,
        bodyEndLine: brace ? brace.endIdx + 1 : undefined,
        children,
        isExported: isPub,
      });
      i = endLine;
      continue;
    }

    // Impl block — its methods belong to the type, not to the file's top level.
    const implMatch = /^impl\b(.*)$/.exec(decl);
    if (implMatch) {
      const header = implMatch[1].trim();
      const brace = findMatchingBrace(i);
      const endLine = brace ? brace.endIdx + 1 : i + 1;
      // `impl Trait for Type` → the implementing type is the last segment.
      const target = (header.split(/\bfor\b/).pop() ?? "").replace(/\{.*$/, "").trim();
      const name = (target.replace(/<.*$/, "").split("::").pop() ?? target).trim() || target;

      const children = brace ? collectFnMethods(i + 1, brace.endIdx) : [];

      symbols.push({
        name,
        kind: "impl",
        startLine: i + 1,
        endLine,
        signature: trimmed.split("{")[0]?.trim(),
        bodyStartLine: brace?.bodyStart,
        bodyEndLine: brace ? brace.endIdx + 1 : undefined,
        children,
        isExported: isPub,
      });
      i = endLine;
      continue;
    }

    // Type alias
    const typeAliasMatch = /^type\s+([A-Za-z0-9_]+)/.exec(decl);
    if (typeAliasMatch) {
      const name = typeAliasMatch[1];
      // A `where` clause or a long generic list can push the `;` several lines down.
      let endIdx = i;
      while (endIdx < total && !lines[endIdx].includes(";")) endIdx++;
      const actualEnd = Math.min(endIdx, total - 1);
      symbols.push({
        name,
        kind: "type",
        startLine: i + 1,
        endLine: actualEnd + 1,
        signature: trimmed.split("=")[0]?.trim(),
        isExported: isPub,
      });
      i = actualEnd + 1;
      continue;
    }

    // Const / static item
    const constMatch = /^(?:const|static)\s+(?:mut\s+)?([A-Za-z0-9_]+)/.exec(decl);
    if (constMatch) {
      const name = constMatch[1];
      symbols.push({
        name,
        kind: "constant",
        startLine: i + 1,
        endLine: i + 1,
        signature: trimmed.split("=")[0]?.trim(),
        isExported: isPub,
      });
      i++;
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
 * Parses a Go source file.
 *
 * Go used to fall through `parseFileAst`'s `default` branch into the TypeScript
 * parser, whose declaration patterns match none of Go's syntax — and `.go` was
 * already in the symbol indexer's extension set, so EVERY function, method,
 * type, const and var in a Go file was silently absent from `find_symbol`.
 * A whole language looked searchable while returning nothing.
 */
function parseGo(lines: string[]): AstSymbol[] {
  const symbols: AstSymbol[] = [];
  const total = lines.length;
  const codeLines = buildCodeLineMask(lines);

  // Go's export rule is lexical: an identifier is exported iff it starts uppercase.
  const isExported = (name: string): boolean => /^[A-Z]/.test(name);

  function findMatchingBrace(startIdx: number): { endIdx: number; bodyStart: number } | null {
    let depth = 0;
    let foundOpen = false;
    let bodyStart = -1;

    for (let k = startIdx; k < total; k++) {
      if (!codeLines[k]) continue;
      const line = lines[k];
      for (let j = 0; j < line.length; j++) {
        const literalLength = stringLiteralLength(line, j);
        if (literalLength > 0) {
          j += literalLength - 1;
          continue;
        }
        const char = line[j];
        if (char === "{") {
          depth++;
          if (!foundOpen) {
            foundOpen = true;
            bodyStart = k + 2;
          }
        } else if (char === "}") {
          depth--;
          if (foundOpen && depth === 0) return { endIdx: k, bodyStart };
        }
      }
    }
    return null;
  }

  /**
   * Method signatures an interface declares: `Name(args) result`. An embedded
   * interface (`io.Reader`) carries no parameter list and is skipped — it is a
   * reference to another type, not a declaration made here.
   */
  function collectInterfaceMethods(bodyStartIdx: number, bodyEndIdx: number): AstSymbol[] {
    const methods: AstSymbol[] = [];
    for (let k = bodyStartIdx; k <= bodyEndIdx; k++) {
      if (!codeLines[k]) continue;
      const line = lines[k].trim();
      const methodMatch = /^([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(line);
      if (methodMatch) {
        methods.push({
          name: methodMatch[1],
          kind: "method",
          startLine: k + 1,
          endLine: k + 1,
          signature: line,
          isExported: isExported(methodMatch[1]),
        });
      }
    }
    return methods;
  }

  let i = 0;
  while (i < total) {
    const trimmed = lines[i].trim();
    if (!trimmed || !codeLines[i]) {
      i++;
      continue;
    }

    // Grouped declaration: `const (`, `var (` and `type (`. Each entry is its own
    // symbol, so the closing paren ends the group rather than the first entry.
    const groupMatch = /^(const|var|type)\s*\(\s*$/.exec(trimmed);
    if (groupMatch) {
      const keyword = groupMatch[1];
      let k = i + 1;
      while (k < total && !/^\s*\)/.test(lines[k])) {
        const entry = lines[k].trim();
        const nameMatch = /^([A-Za-z_][A-Za-z0-9_]*)\s+(?:struct\b|interface\b|=|[A-Za-z_*\[\]])/.exec(entry);
        if (nameMatch && codeLines[k]) {
          const name = nameMatch[1];
          const isStruct = new RegExp(`^${name}\\s+struct\\b`).test(entry);
          const isIface = new RegExp(`^${name}\\s+interface\\b`).test(entry);
          const brace = isStruct || isIface ? findMatchingBrace(k) : null;
          const kind: AstSymbolKind =
            keyword === "const" ? "constant" : isStruct ? "struct" : isIface ? "interface" : "type";
          const members =
            isIface && brace ? collectInterfaceMethods(brace.bodyStart - 1, brace.endIdx) : [];
          symbols.push({
            name,
            kind,
            startLine: k + 1,
            endLine: brace ? brace.endIdx + 1 : k + 1,
            signature: entry,
            bodyStartLine: brace?.bodyStart,
            bodyEndLine: brace ? brace.endIdx + 1 : undefined,
            children: members.length > 0 ? members : undefined,
            isExported: isExported(name),
          });
          k = brace ? brace.endIdx + 1 : k + 1;
          continue;
        }
        k++;
      }
      i = k + 1;
      continue;
    }

    // Function or method. The optional receiver group `(r *Type)` is what
    // distinguishes a method from a free function.
    const funcMatch =
      /^func\s+(?:\(\s*[A-Za-z_][A-Za-z0-9_]*\s+\*?([A-Za-z_][A-Za-z0-9_]*)\s*\)\s*)?([A-Za-z_][A-Za-z0-9_]*)/.exec(
        trimmed
      );
    if (funcMatch) {
      const receiver = funcMatch[1];
      const name = funcMatch[2];
      const brace = findMatchingBrace(i);
      const endLine = brace ? brace.endIdx + 1 : i + 1;
      symbols.push({
        name,
        kind: receiver ? "method" : "function",
        startLine: i + 1,
        endLine,
        signature: trimmed.split("{")[0]?.trim(),
        bodyStartLine: brace?.bodyStart,
        bodyEndLine: brace ? brace.endIdx + 1 : undefined,
        isExported: isExported(name),
      });
      i = endLine;
      continue;
    }

    // Type declaration: struct, interface, alias, or a defined type.
    const typeMatch = /^type\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(trimmed);
    if (typeMatch) {
      const name = typeMatch[1];
      const rest = trimmed.slice(trimmed.indexOf(name) + name.length).trim();
      const kind: AstSymbolKind = /^struct\b/.test(rest)
        ? "struct"
        : /^interface\b/.test(rest)
          ? "interface"
          : "type";
      const brace = kind === "type" ? null : findMatchingBrace(i);
      const members =
        kind === "interface" && brace
          ? collectInterfaceMethods(brace.bodyStart - 1, brace.endIdx)
          : [];
      symbols.push({
        name,
        kind,
        startLine: i + 1,
        endLine: brace ? brace.endIdx + 1 : i + 1,
        signature: trimmed,
        bodyStartLine: brace?.bodyStart,
        bodyEndLine: brace ? brace.endIdx + 1 : undefined,
        children: members.length > 0 ? members : undefined,
        isExported: isExported(name),
      });
      i = brace ? brace.endIdx + 1 : i + 1;
      continue;
    }

    // Package-level const / var.
    const constMatch = /^(const|var)\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(trimmed);
    if (constMatch) {
      const name = constMatch[2];
      symbols.push({
        name,
        kind: constMatch[1] === "const" ? "constant" : "variable",
        startLine: i + 1,
        endLine: i + 1,
        signature: trimmed,
        isExported: isExported(name),
      });
      i++;
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
    case "go":
      symbols = parseGo(lines);
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
