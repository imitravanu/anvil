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
 * Length of the regex literal starting at `j`, or 0 when the character there
 * does not open one.
 *
 * The line scanner had no regex-literal concept, so a backtick inside a
 * character class — this repo's own `/[|;&<>()`$\\\n]/` in bash.ts — opened a
 * phantom template literal and every declaration after it was masked as
 * non-code: `find_symbol` returned zero hits for the exported
 * `isReadOnlyCommand` while the function sat plainly in the file. Regex
 * literals are single-line by language definition, so skipping one needs no
 * cross-line state; that is why this is a pure per-line function.
 *
 * A `/` only opens a regex in expression position (after `=`, `(`, `,`,
 * `return`, start of line, ...) — never after an identifier, number, `)`, `]`,
 * or a quote, where it is division or a member access. An unterminated `/` is
 * left alone: there is no state to carry, and a real regex cannot span lines.
 */
const REGEX_PRECEDING_KEYWORDS = new Set([
  "return", "typeof", "case", "in", "of", "await", "yield", "delete",
  "void", "new", "instanceof", "do", "else", "throw",
]);
const REGEX_PRECEDING_CHARS = "=([,;:?!&|+~^<>{}*%-";

/**
 * Identifier patterns for the declaration scanners, Unicode-aware on purpose.
 * The ASCII classes this file used to carry stopped at the first non-ASCII
 * letter and then published the truncated prefix as the symbol's name: an
 * `export const café = 1` indexed a `caf` that does not exist in the file, a
 * `function fóo` became `f`, and an `interface Ünicode` matched nothing at all
 * — so `find_symbol` answered a name the user never wrote (or nothing, while
 * the declaration sat right there). ECMAScript identifiers additionally allow
 * `$` and Rust/Go/Python do not, so the families get one pattern each.
 * `\p{...}` requires the `u` flag, which is why these are built once at module
 * scope rather than written as literals the scanner would recompile per line.
 */
const IDENT_JS = "[$\\p{L}\\p{Nl}_][$\\u200C\\u200D\\p{L}\\p{Nl}\\p{Mn}\\p{Mc}\\p{Nd}\\p{Pc}_]*";
const IDENT_XID = "[\\p{L}\\p{Nl}_][\\p{L}\\p{Nl}\\p{Mn}\\p{Mc}\\p{Nd}\\p{Pc}_]*";
/** Rust's variant match accepted a leading digit before; keep that tolerance. */
const IDENT_LOOSE = "[\\p{L}\\p{Nl}\\p{Nd}_][\\p{L}\\p{Nl}\\p{Mn}\\p{Mc}\\p{Nd}\\p{Pc}_]*";

const RE_TS_INTERFACE = new RegExp(`^interface\\s+(${IDENT_JS})`, "u");
const RE_TS_TYPE = new RegExp(`^type\\s+(${IDENT_JS})`, "u");
const RE_TS_ENUM = new RegExp(`^enum\\s+(${IDENT_JS})`, "u");
const RE_TS_ENUM_MEMBER = new RegExp(`^(${IDENT_JS}|"[^"]+"|'[^']+')\\s*(?:=|,|$)`, "u");
const RE_TS_CLASS = new RegExp(`^(?:abstract\\s+)?class\\s+(${IDENT_JS})`, "u");
const RE_TS_MEMBER = new RegExp(
  `^(?:public\\s+|private\\s+|protected\\s+|static\\s+|async\\s+|abstract\\s+|override\\s+|declare\\s+|get\\s+|set\\s+)*(?:\\*\\s*)?(constructor|${IDENT_JS})\\s*(\\([^{]*\\))`,
  "u"
);
const TS_CONTROL_KEYWORDS = new Set([
  "if", "for", "while", "switch", "catch", "do", "else", "return",
  "case", "with", "finally", "try", "new",
]);
const RE_TS_ARROW_PROP = new RegExp(
  `^(?:public\\s+|private\\s+|protected\\s+|static\\s+|readonly\\s+|async\\s+|declare\\s+|abstract\\s+|override\\s+)*(${IDENT_JS})\\s*(?:[!:][\\s\\S]*?)?=\\s*(?:async\\s*)?(?:\\([^)]*\\)|${IDENT_JS})\\s*(?::[^=]*)?=>`,
  "u"
);
const RE_TS_FUNCTION = new RegExp(`^(?:async\\s+)?function(?:\\s*\\*|\\s+)\\s*(${IDENT_JS})`, "u");
const RE_TS_ARROW = new RegExp(
  `^(?:const|let|var)\\s+(${IDENT_JS})\\s*=\\s*(?:async\\s*)?(?:\\([^)]*\\)|${IDENT_JS})\\s*=>`,
  "u"
);
const RE_TS_VAR = new RegExp(`^(?:const|let|var)\\s+(${IDENT_JS})`, "u");
const RE_TS_NAMESPACE = new RegExp(
  `^(?:declare\\s+)?(?:namespace|module)\\s+(${IDENT_JS}(?:\\.${IDENT_JS})*|"[^"]+"|'[^']+')`,
  "u"
);
const RE_PY_CLASS = new RegExp(`^class\\s+(${IDENT_XID})`, "u");
const RE_PY_DEF = new RegExp(`^(?:async\\s+)?def\\s+(${IDENT_XID})`, "u");
const RE_RS_FN = new RegExp(`^(?:async\\s+)?fn\\s+(${IDENT_XID})`, "u");
const RE_RS_VARIANT = new RegExp(`^(${IDENT_LOOSE})`, "u");
const RE_RS_STRUCT = new RegExp(`^struct\\s+(${IDENT_XID})`, "u");
const RE_RS_TRAIT = new RegExp(`^trait\\s+(${IDENT_XID})`, "u");
const RE_RS_ENUM = new RegExp(`^enum\\s+(${IDENT_XID})`, "u");
const RE_RS_UNION = new RegExp(`^union\\s+(${IDENT_XID})`, "u");
const RE_RS_MOD = new RegExp(`^mod\\s+(${IDENT_XID})`, "u");
const RE_RS_TYPE_ALIAS = new RegExp(`^type\\s+(${IDENT_XID})`, "u");
const RE_RS_CONST = new RegExp(`^(?:const|static)\\s+(?:mut\\s+)?(${IDENT_XID})`, "u");
const RE_GO_METHOD = new RegExp(`^(${IDENT_XID})\\s*\\(`, "u");
const RE_GO_GROUP_ENTRY = new RegExp(
  `^(${IDENT_XID})\\s+(?:struct\\b|interface\\b|=|[\\p{L}\\p{Nl}_*\\[\\]])`,
  "u"
);
const RE_GO_FUNC = new RegExp(
  `^func\\s+(?:\\(\\s*${IDENT_XID}\\s+\\*?(${IDENT_XID})(?:\\[[^\\]]*\\])?\\s*\\)\\s*)?(${IDENT_XID})`,
  "u"
);
const RE_GO_TYPE = new RegExp(`^type\\s+(${IDENT_XID})`, "u");
const RE_GO_CONST_VAR = new RegExp(`^(const|var)\\s+(${IDENT_XID})`, "u");

/**
 * A symbol's body span, never inverted. The brace scanner reports `bodyStart`
 * as the first line INSIDE the braces, so a one-line `function f() {}` yields
 * bodyStart = braceLine + 1 while its closing brace is still on the brace line:
 * publishing both gave an AstSymbol a body of `2..1`. A body with no interior
 * line has no span, so both coordinates collapse onto the declaration's line.
 * Python's block shape is the same hazard — the body opens on the next line, so
 * a one-line `def f(): pass` would point past its own end.
 */
function bodySpan(
  start: number | undefined,
  end: number | undefined
): { bodyStartLine?: number; bodyEndLine?: number } {
  if (start === undefined || end === undefined) return {};
  return { bodyStartLine: Math.min(start, end), bodyEndLine: end };
}

function regexLiteralLength(line: string, j: number): number {
  if (line[j] !== "/") return 0;
  const after = line[j + 1];
  // `//` and `/*` are comments (the caller handles those first); a pattern
  // whose first character is `/` or `*` escapes it (`\/`, `\*`), so this
  // guard never rejects a real literal.
  if (after === "/" || after === "*") return 0;

  let k = j - 1;
  while (k >= 0 && (line[k] === " " || line[k] === "\t")) k--;
  if (k >= 0 && /[A-Za-z0-9_$]/.test(line[k])) {
    const word = /([A-Za-z_$][A-Za-z0-9_$]*)$/.exec(line.slice(0, k + 1))?.[1] ?? "";
    if (!REGEX_PRECEDING_KEYWORDS.has(word)) return 0;
  } else if (k >= 0 && !REGEX_PRECEDING_CHARS.includes(line[k])) {
    return 0;
  }

  let inClass = false;
  let m = j + 1;
  while (m < line.length) {
    const c = line[m];
    if (c === "\\") {
      m += 2;
      continue;
    }
    if (c === "[") inClass = true;
    else if (c === "]") inClass = false;
    else if (c === "/" && !inClass) {
      let f = m + 1;
      while (f < line.length && /[a-z]/i.test(line[f])) f++;
      return f - j;
    }
    m++;
  }
  return 0;
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
  options: { rustRawStrings?: boolean; regexLiterals?: boolean } = {}
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

      if (options.regexLiterals) {
        const regexLen = regexLiteralLength(line, j);
        if (regexLen > 0) {
          hasCode = true;
          j += regexLen;
          continue;
        }
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
  const codeLines = buildCodeLineMask(lines, { regexLiterals: true });

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

  /** True when `text` starts a new TypeScript/JS declaration (ASI guard). */
  function isTsDeclarationStart(text: string): boolean {
    return /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:const|let|var|function|class|interface|type|enum|import|namespace|declare)\b/.test(
      text
    );
  }

  // Find matching closing brace given an opening line index.
  // Paren-aware: `{}` inside `(...)` (destructured params, object types) must
  // not open the body — the first balanced pair used to be the param object,
  // so the declaration ended on its own signature line and the scanner walked
  // into the real body indexing `if`/`for` as methods.
  function findMatchingBrace(startIdx: number): { endIdx: number; bodyStart: number } | null {
    let depth = 0;
    let parenDepth = 0;
    let foundOpen = false;
    let bodyStart = -1;
    // After `=>` the signature is over — parens are body-level (call args,
    // paren-wrapped object bodies) and must not hide braces. Same once the
    // body has opened: `if (x) {` balances its parens before its brace, but
    // nested arrows/calls must not desync the depth count.
    let signatureDone = false;

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

        const regexLen = regexLiteralLength(line, j);
        if (regexLen > 0) {
          j += regexLen - 1; // the loop's `j++` lands past the literal
          continue;
        }

        if (char === '"' || char === "'" || char === "`") {
          inString = char;
          continue;
        }

        if (!signatureDone && char === "=" && next === ">") {
          signatureDone = true;
          parenDepth = 0;
          j++;
          continue;
        }
        if (!signatureDone && !foundOpen) {
          if (char === "(") {
            parenDepth++;
            continue;
          }
          if (char === ")") {
            if (parenDepth > 0) parenDepth--;
            continue;
          }
          if (parenDepth > 0) continue;
        }

        if (char === "{") {
          depth++;
          if (!foundOpen) {
            foundOpen = true;
            signatureDone = true;
            bodyStart = i + 2;
          }
        } else if (char === "}") {
          depth--;
          if (foundOpen && depth === 0) {
            // A return-type object (`: { ... }`, `Promise<{...}>`) closes before
            // the body opens (`} {`). Returning it ends the declaration on its
            // signature. If another `{` follows on this line, or the next code
            // line opens with `{`, this was the signature — keep looking.
            const rest = line.slice(j + 1);
            if (rest.includes("{")) {
              foundOpen = false;
              bodyStart = -1;
              continue;
            }
            let k = i + 1;
            while (k < total && (!lines[k].trim() || !codeLines[k])) k++;
            if (k < total && lines[k].trimStart().startsWith("{")) {
              foundOpen = false;
              bodyStart = -1;
              continue;
            }
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

    // A multi-line import/export brace list is a module specifier list, not
    // declarations. Its `type Foo,` entries matched the type-alias pattern, so
    // every file that lists types inline published a type alias at an import
    // line (useAgentController.ts reported DisplaySubAgent twice, at the two
    // import lines). Skip the whole clause instead.
    if (/^(?:import|export)\s*(?:type\s+)?\{/.test(trimmed)) {
      const clause = findMatchingBrace(i);
      if (clause) {
        i = clause.endIdx + 1;
        continue;
      }
    }

    const isExported = trimmed.startsWith("export ") || trimmed.startsWith("export default ");
    const decl = isExported ? trimmed.replace(/^export\s+(default\s+)?/, "") : trimmed;

    // Interface definition
    const ifaceMatch = RE_TS_INTERFACE.exec(decl);
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
        ...bodySpan(brace?.bodyStart, brace ? brace.endIdx + 1 : undefined),
        isExported,
      });
      i = endLine;
      continue;
    }

    // Type alias definition
    const typeMatch = RE_TS_TYPE.exec(decl);
    if (typeMatch) {
      const name = typeMatch[1];
      // D1b (AUDIT-2026-09-30): an object alias is brace-matched on its OWN
      // line; a non-object alias (union/intersection/primitive) may span lines,
      // so scan for `;` but STOP at a line that starts a new declaration.
      // Scanning blindly forward for ANY `;` let an ASI-terminated
      // `type Foo = { a: string }` swallow the following `const`/`function`.
      let actualEnd: number;
      if (lines[i].includes("{")) {
        const brace = findMatchingBrace(i);
        actualEnd = brace ? brace.endIdx : i;
      } else {
        let endIdx = i;
        while (endIdx < total) {
          if (lines[endIdx].includes(";")) break;
          if (endIdx > i && codeLines[endIdx] && isTsDeclarationStart(lines[endIdx].trim())) break;
          endIdx++;
        }
        actualEnd = Math.min(endIdx, total - 1);
      }
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
    const enumMatch = RE_TS_ENUM.exec(decl);
    if (enumMatch) {
      const name = enumMatch[1];
      const brace = findMatchingBrace(i);
      const endLine = brace ? brace.endIdx + 1 : i + 1;

      const members: AstSymbol[] = [];
      if (brace) {
        for (let k = brace.bodyStart - 1; k <= brace.endIdx; k++) {
          if (!codeLines[k]) continue;
          const memberLine = lines[k].trim();
          const memberMatch = RE_TS_ENUM_MEMBER.exec(memberLine);
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
        ...bodySpan(brace?.bodyStart, brace ? brace.endIdx + 1 : undefined),
        children: members.length > 0 ? members : undefined,
        isExported,
      });
      i = endLine;
      continue;
    }

    // Class definition
    const classMatch = RE_TS_CLASS.exec(decl);
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
            const methodMatch = RE_TS_MEMBER.exec(innerLine);
            if (methodMatch && !TS_CONTROL_KEYWORDS.has(methodMatch[1])) {
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
                  ...bodySpan(methodBrace?.bodyStart, methodBrace ? methodBrace.endIdx + 1 : undefined),
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
            const arrowPropMatch = RE_TS_ARROW_PROP.exec(innerLine);
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
                ...bodySpan(propBrace?.bodyStart, propBrace ? propBrace.endIdx + 1 : undefined),
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
        ...bodySpan(brace?.bodyStart, brace ? brace.endIdx + 1 : undefined),
        children,
        isExported,
      });
      i = endLine;
      continue;
    }

    // Namespace / module declaration. Its members used to be published as
    // top-level siblings (this scanner does not track nesting) and the
    // namespace itself was invisible — `find_symbol` had no `module` symbol to
    // answer with, although AstSymbolKind declares the kind and the Rust parser
    // already nests `mod` bodies. Same mechanism here: parse the slice and
    // re-base its lines with shiftLines.
    const nsMatch = RE_TS_NAMESPACE.exec(decl);
    if (nsMatch) {
      const name = nsMatch[1];
      const brace = findMatchingBrace(i);
      const endLine = brace ? brace.endIdx + 1 : i + 1;
      const children =
        brace && brace.bodyStart <= brace.endIdx
          ? shiftLines(
              parseTypeScriptJs(lines.slice(brace.bodyStart - 1, brace.endIdx)),
              brace.bodyStart - 1
            )
          : [];
      symbols.push({
        name,
        kind: "module",
        startLine: i + 1,
        endLine,
        signature: trimmed.split("{")[0]?.trim(),
        docstring: extractDocstring(i),
        ...bodySpan(brace?.bodyStart, brace ? brace.endIdx + 1 : undefined),
        children: children.length > 0 ? children : undefined,
        isExported,
      });
      i = endLine;
      continue;
    }

    // Function definition
    const funcMatch = RE_TS_FUNCTION.exec(decl);
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
        ...bodySpan(brace?.bodyStart, brace ? brace.endIdx + 1 : undefined),
        isExported,
      });
      i = endLine;
      continue;
    }

    // Arrow function or const declaration: const foo = (...) => { ... }
    const arrowMatch = RE_TS_ARROW.exec(decl);
    if (arrowMatch) {
      const name = arrowMatch[1];
      // D1a (AUDIT-2026-09-30): brace-match ONLY when this declaration's own
      // line opens the block. An expression-bodied arrow (`const f = (x) => x +
      // 1;`) has no brace, and the old unconditional findMatchingBrace adopted
      // the NEXT declaration's braces — swallowing it whole.
      const brace = lines[i].includes("{") ? findMatchingBrace(i) : null;
      const endLine = brace ? brace.endIdx + 1 : i + 1;
      symbols.push({
        name,
        kind: "function",
        startLine: i + 1,
        endLine,
        signature: trimmed.split("=>")[0]?.trim() + " =>",
        docstring: extractDocstring(i),
        ...bodySpan(brace?.bodyStart, brace ? brace.endIdx + 1 : undefined),
        isExported,
      });
      i = endLine;
      continue;
    }

    // Exported const/let/var variable. A call-wrapped arrow body
    // (`useCallback((x) => { ... }, [])`) is not an arrow match above, but its
    // braces must still be consumed — otherwise the scanner walks into the body
    // and promotes nested locals to file-level symbols. Only arrows consume:
    // plain objects/templates must not adopt the next declaration's braces.
    if (isExported) {
      const varMatch = RE_TS_VAR.exec(decl);
      if (varMatch) {
        const name = varMatch[1];
        const brace = lines[i].includes("{") && lines[i].includes("=>") ? findMatchingBrace(i) : null;
        const endLine = brace ? brace.endIdx + 1 : i + 1;
        symbols.push({
          name,
          kind: "constant",
          startLine: i + 1,
          endLine,
          signature: trimmed,
          docstring: extractDocstring(i),
          ...bodySpan(brace?.bodyStart, brace ? brace.endIdx + 1 : undefined),
          isExported: true,
        });
        if (brace) {
          i = endLine;
          continue;
        }
      }
    }

    // An inline callback body (`it("...", () => { const x ... })`) is not a
    // declaration, but its braces must still be consumed — otherwise nested
    // locals leak to file level and duplicate across `it` blocks.
    if (!isExported && trimmed.includes("=>") && lines[i].includes("{")) {
      const brace = findMatchingBrace(i);
      if (brace) {
        i = brace.endIdx + 1;
        continue;
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

      const nestedClass = RE_PY_CLASS.exec(mTrimmed);
      if (nestedClass) {
        const nName = nestedClass[1];
        const nEnd = findBlockEnd(mIdx, mIndent);
        members.push({
          name: nName,
          kind: "class",
          startLine: mIdx + 1,
          endLine: nEnd + 1,
          signature: mTrimmed.split(":")[0]?.trim(),
          ...bodySpan(mIdx + 2, nEnd + 1),
          children: collectClassMembers(mIndent, mIdx + 1, nEnd),
          isExported: !nName.startsWith("_"),
        });
        mIdx = nEnd + 1;
        continue;
      }

      const methMatch = RE_PY_DEF.exec(mTrimmed);
      if (methMatch) {
        const mEnd = findBlockEnd(mIdx, mIndent);
        members.push({
          name: methMatch[1],
          kind: "method",
          startLine: mIdx + 1,
          endLine: mEnd + 1,
          signature: mTrimmed.split(":")[0]?.trim(),
          ...bodySpan(mIdx + 2, mEnd + 1),
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
    const classMatch = RE_PY_CLASS.exec(trimmed);
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
        ...bodySpan(i + 2, endIdx + 1),
        children,
        isExported: !name.startsWith("_"),
      });
      i = endIdx + 1;
      continue;
    }

    // Function definition
    const funcMatch = RE_PY_DEF.exec(trimmed);
    if (funcMatch) {
      const name = funcMatch[1];
      const endIdx = findBlockEnd(i, indent);
      symbols.push({
        name,
        kind: "function",
        startLine: i + 1,
        endLine: endIdx + 1,
        signature: trimmed.split(":")[0]?.trim(),
        ...bodySpan(i + 2, endIdx + 1),
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
 * Removes a leading balanced `<...>` group from `s` — e.g. the impl generics in
 * `impl<T: Into<U>> Foo`. Braces are depth-counted, so a generic bound that
 * itself contains `>` does not end the group early.
 */
function stripLeadingGenericGroup(s: string): string {
  const t = s.trimStart();
  if (!t.startsWith("<")) return t;
  let depth = 0;
  for (let k = 0; k < t.length; k++) {
    if (t[k] === "<") depth++;
    else if (t[k] === ">") {
      depth--;
      if (depth === 0) return t.slice(k + 1).trimStart();
    }
  }
  return t;
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
            // D1f (AUDIT-2026-09-30): bodyStart is the line AFTER the brace's
            // line, matching TS (`i + 2`) and Go (`k + 2`). It was `i + 1`, so
            // the skeleton started on the signature line and deleted
            // `pub fn foo() {` from the outline.
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
        const methodMatch = RE_RS_FN.exec(innerDecl);
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
            ...bodySpan(bounded ? methodBrace?.bodyStart : undefined, bounded && methodBrace ? methodBrace.endIdx + 1 : undefined),
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
        const variantMatch = RE_RS_VARIANT.exec(line);
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

    // D1c (AUDIT-2026-09-30): `pub(crate)` / `pub(super)` are public and must be
    // stripped before declaration matching — `startsWith("pub ")` is false for
    // them, so the `fn` rule never matched and the function vanished entirely.
    const pubMatch = /^pub(?:\([^)]*\))?\s+/.exec(trimmed);
    const isPub = pubMatch !== null;
    const decl = pubMatch ? trimmed.slice(pubMatch[0].length) : trimmed;

    // Struct
    const structMatch = RE_RS_STRUCT.exec(decl);
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
        ...bodySpan(brace?.bodyStart, brace ? brace.endIdx + 1 : undefined),
        isExported: isPub,
      });
      i = endLine;
      continue;
    }

    // Trait — its methods are the interface an agent searches for by name.
    const traitMatch = RE_RS_TRAIT.exec(decl);
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
        ...bodySpan(brace?.bodyStart, brace ? brace.endIdx + 1 : undefined),
        children: children.length > 0 ? children : undefined,
        isExported: isPub,
      });
      i = endLine;
      continue;
    }

    // Enum — variants are indexed so `Mode::Fast` is findable by name.
    const enumMatch = RE_RS_ENUM.exec(decl);
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
        ...bodySpan(brace?.bodyStart, brace ? brace.endIdx + 1 : undefined),
        children: variants.length > 0 ? variants : undefined,
        isExported: isPub,
      });
      i = endLine;
      continue;
    }

    // Union (a braced record type, same shape as a struct)
    const unionMatch = RE_RS_UNION.exec(decl);
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
        ...bodySpan(brace?.bodyStart, brace ? brace.endIdx + 1 : undefined),
        isExported: isPub,
      });
      i = endLine;
      continue;
    }

    // Module — `mod m { … }` nests its contents; `mod m;` is a single line.
    // The body is parsed recursively and re-based so `find_symbol` still reaches
    // nested functions (the index flattens children) instead of promoting them
    // to file-level declarations with a wrong parent.
    const modMatch = RE_RS_MOD.exec(decl);
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
        ...bodySpan(brace?.bodyStart, brace ? brace.endIdx + 1 : undefined),
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
      // D1d (AUDIT-2026-09-30): `impl<T> Foo<T>` produced the garbage name
      // `<T> Foo<T>`. Strip the impl's own leading generic group (balanced
      // `<...>`) and any `where` clause first, then take the last `for` segment
      // and drop the target's trailing generics.
      const withoutImplGenerics = stripLeadingGenericGroup(header)
        .replace(/\bwhere\b[\s\S]*$/, "")
        .trim();
      const target = (withoutImplGenerics.split(/\bfor\b/).pop() ?? "").replace(/\{.*$/, "").trim();
      const name = (target.replace(/<.*$/, "").split("::").pop() ?? target).trim() || target;

      const children = brace ? collectFnMethods(i + 1, brace.endIdx) : [];

      symbols.push({
        name,
        kind: "impl",
        startLine: i + 1,
        endLine,
        signature: trimmed.split("{")[0]?.trim(),
        ...bodySpan(brace?.bodyStart, brace ? brace.endIdx + 1 : undefined),
        children,
        isExported: isPub,
      });
      i = endLine;
      continue;
    }

    // Type alias
    const typeAliasMatch = RE_RS_TYPE_ALIAS.exec(decl);
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
    const constMatch = RE_RS_CONST.exec(decl);
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
    const fnMatch = RE_RS_FN.exec(decl);
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
        ...bodySpan(brace?.bodyStart, brace ? brace.endIdx + 1 : undefined),
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
      const methodMatch = RE_GO_METHOD.exec(line);
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
        const nameMatch = RE_GO_GROUP_ENTRY.exec(entry);
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
            ...bodySpan(brace?.bodyStart, brace ? brace.endIdx + 1 : undefined),
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
    const funcMatch = RE_GO_FUNC.exec(trimmed);
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
        ...bodySpan(brace?.bodyStart, brace ? brace.endIdx + 1 : undefined),
        isExported: isExported(name),
      });
      i = endLine;
      continue;
    }
    // D1e (AUDIT-2026-09-30): a `func` this regex cannot read (e.g. a generic
    // receiver) must still consume its BODY. Otherwise the `var`/`const` lines
    // inside it match the package-level rule and leak as top-level symbols —
    // the `Stack[T]` receiver both dropped `Push` and promoted `x`.
    if (/^func\b/.test(trimmed)) {
      const brace = findMatchingBrace(i);
      i = brace ? brace.endIdx + 1 : i + 1;
      continue;
    }

    // Type declaration: struct, interface, alias, or a defined type.
    const typeMatch = RE_GO_TYPE.exec(trimmed);
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
        ...bodySpan(brace?.bodyStart, brace ? brace.endIdx + 1 : undefined),
        children: members.length > 0 ? members : undefined,
        isExported: isExported(name),
      });
      i = brace ? brace.endIdx + 1 : i + 1;
      continue;
    }

    // Package-level const / var.
    const constMatch = RE_GO_CONST_VAR.exec(trimmed);
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
