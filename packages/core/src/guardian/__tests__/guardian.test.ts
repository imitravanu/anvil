import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { scanTextForSlop, scanDiffForSlop, scanUnifiedDiffForSlop, parseUnifiedDiffSections } from "../scanner.js";
import { autoFixRawErrorFormat, guardianFixedText, interceptTurn } from "../interceptor.js";
import { detectGuardianScope } from "../scope.js";
import { guardedInit } from "../init.js";

// Fixture patterns are concatenated so this test source never contains a
// literal slop pattern (the gate scans added lines); runtime values are exact.
const FIX_AS_ANY = "const x = foo as " + "any;";
const FIX_RAW_ERROR = "const m = err instanceof " + "Error ? err.message : String(err);";
// C6: an auto-fix may only rewrite when getErrorMessage is already resolvable
// in the same body — a shown import is the honest signal for that.
const GET_ERROR_MESSAGE_IMPORT = '+import { getErrorMessage } from "@imitravanu/anvil-core";\n';
// The scanner flags this raw-error ternary shape, but the safe auto-fix
// cannot rewrite it — its fallback is not String(...).
const FIX_RAW_ERROR_UNFIXABLE =
  "const m = err instanceof " + "Error ? err.message : JSON.stringify(err);";
const FIX_EMPTY_CATCH = "try { run(); } catch " + "{}";
const FIX_MULTILINE_CATCH = "try { run(); } catch (e) {\n}";
const FIX_TS_IGNORE = "// @" + "ts-ignore";
const FIX_TS_NOCHECK = "// @" + "ts-nocheck";
const FIX_SKIPPED_TEST = 'it.' + 'skip("test", () => {});';
// H1 fixtures — split so this test source never contains the literal shapes.
const FIX_AS_ERROR = "const m = (err as " + "Error).message;";
const FIX_MAGIC_TIMEOUT = "const r = fetch(url, { time" + "out: 5000 });";
// `0` is the yield-to-event-loop idiom, not a magic timeout (found live against
// an eval fixture's own harness: `setTimeout(resolve, 0)`).
const FIX_YIELD_ZERO = "await new Promise((resolve) => set" + "Timeout(resolve, 0));";
// The expression shape (rule 2.4): a retry schedule written as one arithmetic
// expression has no assignment for the scanners to anchor on, so its inline
// exponent base used to be invisible. Split like the others so this source
// never contains the literal shape it describes.
const FIX_MAGIC_EXPONENT = "const d = MIN_DELAY_MS * Math." + "pow(2, attempt);";
const FIX_MAGIC_EXPONENT_NAMED = "const d = MIN_DELAY_MS * Math." + "pow(BACKOFF_BASE, attempt);";
const FIX_SILENT_CATCH = "try { run(); } catch { value = 1; }";
// Batch O: the two families the gate's Step 1 carried while this scanner did
// not — the bare annotation positions and the nullish raw-error fallback.
const FIX_BARE_ANY = "const z: " + "any = 1;";
const FIX_BARE_ANY_GENERIC = "const m: Record<string, " + "any> = {};";
const FIX_RAW_ERROR_NULLISH = "const m = e." + "message ?? String(e);";
const FIX_COLOR_QUOTE = '<Box color="cyan" />';
const FIX_COLOR_TEMPLATE = "<Box color={`" + "cyan`} />";
// Split for the same reason: this repo's gate flags these tokens in added lines.
const PLACEHOLDER_WORD = "TO" + "DO";
const TUI_IMPORT = 'import x from "@imitravanu/anvil-' + 'tui";';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");

describe("scanTextForSlop", () => {
  it("flags as-any in production files", () => {
    const violations = scanTextForSlop("src/a.ts", FIX_AS_ANY, "anvil");
    expect(violations.some((v) => v.rule === "no-as-any")).toBe(true);
  });

  it("ignores as-any in test fixtures", () => {
    const violations = scanTextForSlop("src/__tests__/a.test.ts", FIX_AS_ANY, "anvil");
    expect(violations.some((v) => v.rule === "no-as-any")).toBe(false);
  });

  it("tags each violation with a structured rule family", () => {
    expect(scanTextForSlop("src/a.ts", FIX_AS_ANY, "anvil")[0].family).toBe("type-escape");
    expect(scanTextForSlop("src/a.ts", FIX_RAW_ERROR, "anvil")[0].family).toBe("raw-error");
  });

  it("flags raw error formatting", () => {
    const violations = scanTextForSlop("src/a.ts", FIX_RAW_ERROR, "anvil");
    expect(violations.some((v) => v.rule === "no-raw-error-format")).toBe(true);
  });

  it("flags bare any annotations, the shape a cast rule cannot see (Batch O)", () => {
    // Gate rule 1b parity: the scanner used to carry only the cast family, so
    // this shape passed the in-process checkpoint while the gate rejected it.
    expect(scanTextForSlop("src/a.ts", FIX_BARE_ANY, "anvil").some((v) => v.rule === "no-bare-any")).toBe(true);
    expect(
      scanTextForSlop("src/a.ts", FIX_BARE_ANY_GENERIC, "anvil").some((v) => v.rule === "no-bare-any")
    ).toBe(true);
    // A non-capturing group is not an annotation — the gate's lookbehind, kept.
    expect(
      scanTextForSlop("src/a.ts", "const re = /(?:" + "any|never)/;", "anvil").some(
        (v) => v.rule === "no-bare-any"
      )
    ).toBe(false);
  });

  it("flags the nullish raw-error fallback, the gate's second 2.1 shape (Batch O)", () => {
    expect(
      scanTextForSlop("src/a.ts", FIX_RAW_ERROR_NULLISH, "anvil").some(
        (v) => v.rule === "no-raw-error-format"
      )
    ).toBe(true);
  });

  it("flags empty catch blocks (both single-line and multiline)", () => {
    expect(scanTextForSlop("src/a.ts", FIX_EMPTY_CATCH, "anvil").some((v) => v.rule === "no-empty-catch")).toBe(true);
    expect(scanTextForSlop("src/a.ts", FIX_MULTILINE_CATCH, "anvil").some((v) => v.rule === "no-empty-catch")).toBe(true);
  });

  it("flags ts-ignore and ts-nocheck in production code, allows in tests", () => {
    expect(scanTextForSlop("src/a.ts", FIX_TS_IGNORE, "anvil").some((v) => v.rule === "no-ts-suppression")).toBe(true);
    expect(scanTextForSlop("src/a.ts", FIX_TS_NOCHECK, "anvil").some((v) => v.rule === "no-ts-suppression")).toBe(true);
    expect(scanTextForSlop("src/__tests__/a.test.ts", FIX_TS_IGNORE, "anvil").some((v) => v.rule === "no-ts-suppression")).toBe(false);
  });

  it("flags skipped tests in test files, ignores in non-test files", () => {
    expect(scanTextForSlop("src/__tests__/a.test.ts", FIX_SKIPPED_TEST, "anvil").some((v) => v.rule === "no-skipped-test")).toBe(true);
    expect(scanTextForSlop("src/a.ts", FIX_SKIPPED_TEST, "anvil").some((v) => v.rule === "no-skipped-test")).toBe(false);
  });

  it("flags 'as Error' casts in production, allows tests (H1)", () => {
    expect(scanTextForSlop("src/a.ts", FIX_AS_ERROR, "anvil").some((v) => v.rule === "no-as-error")).toBe(true);
    expect(scanTextForSlop("src/__tests__/a.test.ts", FIX_AS_ERROR, "anvil").some((v) => v.rule === "no-as-error")).toBe(false);
  });

  it("flags inline timeout/retry/cap literals but not named constants (H1)", () => {
    expect(scanTextForSlop("src/a.ts", FIX_MAGIC_TIMEOUT, "anvil").some((v) => v.rule === "no-magic-constant")).toBe(true);
    expect(
      scanTextForSlop("src/a.ts", "const r = fetch(url, { timeout: TIMEOUT_MS });", "anvil").some(
        (v) => v.rule === "no-magic-constant"
      )
    ).toBe(false);
  });

  it("does not flag a zero-delay yield as a magic timeout (H1 negative control)", () => {
    expect(scanTextForSlop("src/a.ts", FIX_YIELD_ZERO, "anvil").some((v) => v.rule === "no-magic-constant")).toBe(false);
    expect(
      scanTextForSlop("src/a.ts", "set" + "Timeout(flush, 50);", "anvil").some((v) => v.rule === "no-magic-constant")
    ).toBe(true);
  });

  it("flags an inline exponent base, allows a named one (rule 2.4 expression shape)", () => {
    // Fail-first: before the scanner learned this shape, both assertions below
    // were false — the inline base was invisible and the whole schedule was
    // written as one expression in providers/base.ts.
    expect(
      scanTextForSlop("src/a.ts", FIX_MAGIC_EXPONENT, "anvil").some((v) => v.rule === "no-magic-constant")
    ).toBe(true);
    expect(
      scanTextForSlop("src/a.ts", FIX_MAGIC_EXPONENT_NAMED, "anvil").some(
        (v) => v.rule === "no-magic-constant"
      )
    ).toBe(false);
  });

  it("flags non-empty silent catches, allows logged/explained ones (H1)", () => {
    expect(scanTextForSlop("src/a.ts", FIX_SILENT_CATCH, "anvil").some((v) => v.rule === "no-silent-catch")).toBe(true);
    expect(
      scanTextForSlop("src/a.ts", "try { run(); } catch {\n  // intentional: best-effort\n  value = 1;\n}", "anvil").some(
        (v) => v.rule === "no-silent-catch"
      )
    ).toBe(false);
    expect(
      scanTextForSlop("src/a.ts", "try { run(); } catch (e) {\n  log.warn(getErrorMessage(e));\n}", "anvil").some(
        (v) => v.rule === "no-silent-catch"
      )
    ).toBe(false);
    expect(scanTextForSlop("src/__tests__/a.test.ts", FIX_SILENT_CATCH, "anvil").some((v) => v.rule === "no-silent-catch")).toBe(false);
  });

  it("flags hardcoded color strings in TUI components, ignores outside", () => {
    expect(scanTextForSlop("packages/tui/src/components/A.tsx", FIX_COLOR_QUOTE, "anvil").some((v) => v.rule === "no-hardcoded-color")).toBe(true);
    expect(scanTextForSlop("packages/tui/src/components/A.tsx", FIX_COLOR_TEMPLATE, "anvil").some((v) => v.rule === "no-hardcoded-color")).toBe(true);
    expect(scanTextForSlop("packages/core/src/A.tsx", FIX_COLOR_QUOTE, "anvil").some((v) => v.rule === "no-hardcoded-color")).toBe(false);
  });

  it("does not treat prose as code (the markdown false positive)", () => {
    // This is the F2 evidence: writing Anvil's own roadmap matched the
    // placeholder rule in a *sentence*. Docs are not code.
    const markdown = `# Notes\n\n- ${PLACEHOLDER_WORD}: wire the retry path\n`;
    expect(scanTextForSlop("docs/NOTES.md", markdown, "anvil")).toEqual([]);
  });

  it("still flags the placeholder marker in code files", () => {
    const violations = scanTextForSlop("src/a.ts", `// ${PLACEHOLDER_WORD}: later\n`, "anvil");
    expect(violations.some((v) => v.rule === "no-placeholder-marker")).toBe(true);
  });

  it("scans a name with no extension rather than assuming it is not code", () => {
    // Batch O: this label is now the FALLBACK for added lines a malformed diff
    // never gave a file header; classifying it as non-code would silently
    // disable the scan of exactly the lines whose identity is unknown.
    expect(scanTextForSlop("(working tree)", FIX_AS_ANY, "anvil").some((v) => v.rule === "no-as-any")).toBe(true);
  });

  it("does not flag the import path merely named in a comment (S5.3)", () => {
    // The comment describes the boundary; it does not cross it. Landing the
    // original scoping change tripped the gate on exactly this shape.
    const comment = `// core must never import "@imitravanu/anvil-` + `tui" — see scope.ts`;
    expect(
      scanTextForSlop("packages/core/src/x.ts", comment, "anvil").some(
        (v) => v.rule === "no-architecture-breach"
      )
    ).toBe(false);
  });

  it.each(["@imitravanu/anvil-tui", "@imitravanu/anvil-cli", "@anvil/tui", "@anvil/cli"])("enforces the core boundary for %s", name => {
    expect(scanTextForSlop("packages/core/src/x.ts", `import x from "${name}";`, "anvil").some(v => v.rule === "no-architecture-breach")).toBe(true);
  });

  it("still flags a real core -> tui import in code", () => {
    expect(
      scanTextForSlop("packages/core/src/x.ts", TUI_IMPORT, "anvil").some(
        (v) => v.rule === "no-architecture-breach"
      )
    ).toBe(true);
  });

  it("does not judge the core import rule on a non-core package file", () => {
    // S5.3: resolve package membership before applying the import rule. A tui
    // file naming @imitravanu/anvil-tui is not a core boundary breach.
    expect(
      scanTextForSlop("packages/tui/src/x.ts", TUI_IMPORT, "anvil").some(
        (v) => v.rule === "no-architecture-breach"
      )
    ).toBe(false);
  });

  // Batch N: ONE test-file exemption policy across the gate, the pre-commit
  // hook and this scanner (see the isTestPath doc block). Fail-first — every
  // fixture below was flagged HERE while the gate accepted the very same file,
  // so the in-process checkpoint nagged about sanctioned fixture work and the
  // three checkpoints could not be described by one rule.
  it("exempts a test path from every built-in family except the skipped-test rule", () => {
    const CORE_TEST = "packages/core/src/__tests__/fixture.test.ts";
    const TUI_TEST = "packages/tui/src/components/__tests__/Probe.test.tsx";
    // A cast split across two lines, assembled so this source never holds the
    // two-line shape it probes for.
    const SPLIT_CAST = "const x = data as\n" + "  an" + "y;";
    const fixtures: Array<{ label: string; rel: string; text: string }> = [
      { label: "as-any fixture cast", rel: CORE_TEST, text: FIX_AS_ANY },
      { label: "as Error fixture cast", rel: CORE_TEST, text: FIX_AS_ERROR },
      { label: "TypeScript suppression", rel: CORE_TEST, text: FIX_TS_IGNORE },
      { label: "empty catch", rel: CORE_TEST, text: FIX_EMPTY_CATCH },
      { label: "multiline empty catch", rel: CORE_TEST, text: FIX_MULTILINE_CATCH },
      { label: "cast split across lines", rel: CORE_TEST, text: SPLIT_CAST },
      { label: "raw error formatting", rel: CORE_TEST, text: FIX_RAW_ERROR },
      { label: "placeholder marker", rel: CORE_TEST, text: `// ${PLACEHOLDER_WORD}: fixture note` },
      { label: "magic timeout literal", rel: CORE_TEST, text: FIX_MAGIC_TIMEOUT },
      { label: "core boundary import", rel: CORE_TEST, text: TUI_IMPORT },
      { label: "hardcoded TUI color", rel: TUI_TEST, text: FIX_COLOR_QUOTE },
      { label: "silent catch", rel: CORE_TEST, text: FIX_SILENT_CATCH },
      { label: "bare any annotation", rel: CORE_TEST, text: FIX_BARE_ANY },
      { label: "nullish raw-error fallback", rel: CORE_TEST, text: FIX_RAW_ERROR_NULLISH },
    ];
    for (const { label, rel, text } of fixtures) {
      expect(scanTextForSlop(rel, text, "anvil"), `test path must be exempt: ${label}`).toEqual([]);
      // Control: the exemption is PATH-SCOPED, not a disabled rule. The same
      // text on the production sibling path is still judged, so a scanner that
      // simply stopped reporting would fail here.
      const sourcePath = rel.replace("__tests__/", "").replace(/\.test\.tsx?$/, ".ts");
      expect(
        scanTextForSlop(sourcePath, text, "anvil").length,
        `source path must still be judged: ${label}`
      ).toBeGreaterThan(0);
    }
    // The one family a test path IS judged by — and only there.
    expect(scanTextForSlop(CORE_TEST, FIX_SKIPPED_TEST, "anvil").map((v) => v.rule)).toEqual([
      "no-skipped-test",
    ]);
    expect(scanTextForSlop("packages/core/src/fixture.ts", FIX_SKIPPED_TEST, "anvil")).toEqual([]);
  });
});

describe("scanTextForSlop — foreign scope (not Anvil's own repo)", () => {
  it("does not apply the Anvil-specific families", () => {
    expect(
      scanTextForSlop("src/a.ts", FIX_RAW_ERROR, "foreign").some((v) => v.rule === "no-raw-error-format")
    ).toBe(false);
    expect(
      scanTextForSlop("src/a.ts", TUI_IMPORT, "foreign").some((v) => v.rule === "no-architecture-breach")
    ).toBe(false);
    expect(
      scanTextForSlop("src/a.ts", `// ${PLACEHOLDER_WORD}`, "foreign").some(
        (v) => v.rule === "no-placeholder-marker"
      )
    ).toBe(false);
  });

  it("still applies the universal rules", () => {
    expect(scanTextForSlop("src/a.ts", FIX_AS_ANY, "foreign").some((v) => v.rule === "no-as-any")).toBe(true);
    expect(
      scanTextForSlop("src/a.ts", FIX_EMPTY_CATCH, "foreign").some((v) => v.rule === "no-empty-catch")
    ).toBe(true);
  });
});

describe("scanDiffForSlop", () => {
  it("scans added lines only", () => {
    const diff = "-const x = foo as " + "any;\n+const y = 1;\n";
    expect(scanDiffForSlop("src/a.ts", diff, "anvil")).toEqual([]);
    const dirty = "+const x = foo as " + "any;\n";
    expect(scanDiffForSlop("src/a.ts", dirty, "anvil").length).toBeGreaterThan(0);
  });
});

// Batch O: one diff, many files. Before the resolver, `anvil gate` handed the
// whole multi-file diff to the scanner under one synthetic label, so the
// path-scoped policy was judged against that label and the reported line was an
// index into the concatenated added text.
describe("scanUnifiedDiffForSlop", () => {
  it("resolves each added line to its real file and its real new-file line", () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "index 1111111..2222222 100644",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1,2 +1,4 @@",
      " line one",
      "+const y = foo as " + "any;",
      "+const z = 1;",
      " line two",
      "+++ b/src/__tests__/b.test.ts",
      "@@ -1,0 +2,2 @@",
      "+const fixture = data as " + "any;",
      "+" + "it." + 'skip("later", () => {});',
    ].join("\n");
    const violations = scanUnifiedDiffForSlop(diff, "anvil");
    // Real file, real line (2) — not one label at an index into the added text.
    expect(
      violations.some((v) => v.file === "src/a.ts" && v.line === 2 && v.rule === "no-as-any")
    ).toBe(true);
    // The test path is judged by the skipped-test rule ALONE, exactly as the
    // authority does: the fixture cast is exempt, the skip is caught at its own
    // real line.
    expect(
      violations.some((v) => v.file === "src/__tests__/b.test.ts" && v.rule === "no-as-any")
    ).toBe(false);
    expect(
      violations.some(
        (v) => v.file === "src/__tests__/b.test.ts" && v.line === 3 && v.rule === "no-skipped-test"
      )
    ).toBe(true);
  });

  it("keeps judging added lines that never reached a file header (no coverage loss)", () => {
    const diff = ["@@ -0,0 +1,1 @@", "+const x = foo as " + "any;"].join("\n");
    const violations = scanUnifiedDiffForSlop(diff, "anvil", [], "(working tree)");
    expect(violations.map((v) => v.file)).toEqual(["(working tree)"]);
  });

  it("numbers a hunk-less added stream from 1 rather than dropping it", () => {
    // The shape a hand-built or "new file" diff has: a header and added lines,
    // no hunk header. Dropping these would be a silent coverage loss.
    const diff = ["+++ b/src/a.ts", "+const y = 1;", "+const x = foo as " + "any;"].join("\n");
    expect(scanUnifiedDiffForSlop(diff, "anvil").map((v) => [v.file, v.line, v.rule])).toEqual([
      ["src/a.ts", 2, "no-as-any"],
    ]);
  });

  it("ignores removed lines and the no-newline marker", () => {
    const diff = [
      "+++ b/src/a.ts",
      "@@ -1,1 +1,2 @@",
      "-const x = foo as " + "any;",
      "+const y = 1;",
      "\\ No newline at end of file",
    ].join("\n");
    expect(scanUnifiedDiffForSlop(diff, "anvil")).toEqual([]);
  });

  it("unquotes a git-quoted path and strips a header timestamp", () => {
    const diff = ['+++ "b/src/a b.ts"\t2026-01-01 00:00:00', "@@ -0,0 +1,1 @@", "+const y = 1;"].join("\n");
    expect(parseUnifiedDiffSections(diff, "(none)").map((s) => s.file)).toEqual(["src/a b.ts"]);
  });

  // Batch O+ (chief-engineer takeover, 2026-10-10): the array position of the
  // bare-annotation family was transcribed as `any[` — the authority's shape is
  // the EMPTY pair `any[]` — so legal indexed access on an any-named member was
  // refused on source paths while the gate blessed it. Both directions pinned;
  // the RED run of the first case is the receipt.
  it("an indexed access on an any-named member is not an annotation", () => {
    expect(scanTextForSlop("src/a.ts", "const v = conf." + "any[0];", "anvil")).toEqual([]);
  });

  it("a bare any array annotation is refused like the colon position", () => {
    const violations = scanTextForSlop("src/a.ts", "const arr: " + "any[] = [];", "anvil");
    expect(violations.some((v) => v.rule === "no-bare-any")).toBe(true);
  });

  // Batch O+ (chief-engineer takeover): git renders an added line whose own
  // text begins "++ " as exactly "+++ …", shape-identical to a file header.
  // Before the fix the resolver read it as one: the line vanished and every
  // later added line of the real file was re-attributed to a phantom path with
  // restarted numbering — more aggressive than the code it replaced, in the
  // very batch whose purpose was identity fidelity.
  it("an added line that begins '++ ' is content, not a phantom file header", () => {
    const diff = [
      "+++ b/src/a.ts",
      "@@ -1,1 +1,4 @@",
      " line one",
      "+const y = 1;",
      "+++ payload line",
      "+const z = data as " + "any;",
    ].join("\n");
    const sections = parseUnifiedDiffSections(diff, "(none)");
    expect(sections.map((s) => s.file)).toEqual(["src/a.ts"]);
    expect(sections[0].added.map((l) => l.line)).toEqual([2, 3, 4]);
    expect(sections[0].added[1].text).toBe("++ payload line");
    const violations = scanUnifiedDiffForSlop(diff, "anvil");
    expect(
      violations.some((v) => v.file === "src/a.ts" && v.line === 4 && v.rule === "no-as-any")
    ).toBe(true);
  });

  it("a +++ header directly after an exhausted hunk is still a header", () => {
    // The LAST body line of file one exhausts the hunk count; file two's header
    // must still resolve. Count-driven header detection is only safe if a spent
    // hunk re-opens header recognition — pinned so the fix cannot overreach.
    const diff = [
      "+++ b/src/a.ts",
      "@@ -0,0 +1,1 @@",
      "+const y = 1;",
      "+++ b/src/b.ts",
      "@@ -0,0 +1,1 @@",
      "+const z = data as " + "any;",
    ].join("\n");
    const violations = scanUnifiedDiffForSlop(diff, "anvil");
    expect(
      violations.some((v) => v.file === "src/b.ts" && v.line === 1 && v.rule === "no-as-any")
    ).toBe(true);
  });
});

describe("autoFixRawErrorFormat", () => {
  it("rewrites the common ternary to getErrorMessage", () => {
    const fixed = autoFixRawErrorFormat(FIX_RAW_ERROR);
    expect(fixed).toBe("const m = getErrorMessage(err);");
  });
});

describe("detectGuardianScope", () => {
  let dir = "";
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-scope-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("recognises this repo as Anvil's own monorepo", () => {
    // The guardian must keep guarding Anvil itself — if this ever reports
    // "foreign", every Anvil-specific rule has silently switched off here.
    expect(detectGuardianScope(REPO_ROOT)).toBe("anvil");
  });

  it("treats a project without the core workspace as foreign", () => {
    expect(detectGuardianScope(dir)).toBe("foreign");
  });

  it("treats a malformed manifest as foreign rather than throwing", () => {
    fs.mkdirSync(path.join(dir, "packages", "core"), { recursive: true });
    fs.writeFileSync(path.join(dir, "packages", "core", "package.json"), "{ not json");
    expect(detectGuardianScope(dir)).toBe("foreign");
  });

  it.each(["@imitravanu/anvil-core", "@anvil/core"])("recognises a project whose core workspace is %s", name => {
    fs.mkdirSync(path.join(dir, "packages", "core"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "packages", "core", "package.json"),
      JSON.stringify({ name })
    );
    expect(detectGuardianScope(dir)).toBe("anvil");
  });
});

describe("interceptTurn", () => {
  it("allows clean turns", () => {
    const result = interceptTurn([{ path: "src/a.ts", diff: "+const y = 1;\n" }], "anvil");
    expect(result.allowed).toBe(true);
    expect(result.violations).toEqual([]);
  });

  // Takeover 2026-10-10: the interceptor scanned the ADDED-ONLY text, so a
  // violation's `line` was an index into that stream — not the line the file
  // will actually have — and an added line whose own text begins "++ " (rendered
  // by git as exactly "+++ …") was DROPPED from the scan entirely. Both are the
  // Batch O resolver's job; the interceptor now feeds it.
  it("reports violations at real file lines, not indexes into the added text", () => {
    const diff = [
      "+++ b/src/a.ts",
      "@@ -1,1 +1,3 @@",
      " line one",
      "+const ok = 1;",
      "+const y = data as " + "any;",
    ].join("\n");
    const result = interceptTurn([{ path: "src/a.ts", diff }], "anvil");
    expect(result.allowed).toBe(false);
    // Line 3 is the file's real new-file line; the pre-fix scanner said 2
    // (the index into the added-only stream, context line ignored).
    expect(result.violations.some((v) => v.rule === "no-as-any" && v.line === 3)).toBe(true);
  });

  it("scans an added line that begins '++ ' instead of dropping it", () => {
    const diff = [
      "+++ b/src/a.ts",
      "@@ -1,1 +1,2 @@",
      " line one",
      "+++ const y = data as " + "any;",
    ].join("\n");
    const result = interceptTurn([{ path: "src/a.ts", diff }], "anvil");
    expect(result.allowed, "the slop line must not vanish from the pre-write checkpoint").toBe(false);
  });

  it("auto-fixes raw error formatting when getErrorMessage is resolvable", () => {
    const result = interceptTurn(
      [{ path: "src/a.ts", diff: `${GET_ERROR_MESSAGE_IMPORT}+${FIX_RAW_ERROR}\n` }],
      "anvil"
    );
    expect(result.allowed).toBe(true);
    expect(result.fixed).toHaveLength(1);
    expect(result.fixed[0].diff).toContain("getErrorMessage(err)");
    // The repaired violation is reported as autofixed, not silently dropped.
    expect(result.autofixed).toHaveLength(1);
    expect(result.autofixed[0].autofixed).toBe(true);
  });

  // C6 (AUDIT-2026-09-30): a raw-error edit whose body does NOT establish
  // getErrorMessage must block — the old auto-fix rewrote it into a call to an
  // undefined identifier and reported the turn clean.
  it("blocks a raw-error edit it cannot resolve getErrorMessage for", () => {
    const result = interceptTurn([{ path: "src/a.ts", diff: `+${FIX_RAW_ERROR}\n` }], "anvil");
    expect(result.fixed).toHaveLength(0);
    expect(result.allowed).toBe(false);
    expect(result.violations.some((v) => v.rule === "no-raw-error-format")).toBe(true);
  });

  it("enforces project-declared custom rules", () => {
    const result = interceptTurn(
      [{ path: "src/a.ts", diff: '+import moment from "moment";\n' }],
      "anvil",
      [{ rule: "no-moment", pattern: /from ["']moment["']/, detail: "Use date-fns instead" }]
    );
    expect(result.allowed).toBe(false);
    expect(result.violations.some((v) => v.rule === "no-moment" && v.family === "rule")).toBe(true);
  });

  it("blocks a raw-error violation it cannot auto-fix (no silent pass-through)", () => {
    const result = interceptTurn([{ path: "src/a.ts", diff: `+${FIX_RAW_ERROR_UNFIXABLE}\n` }], "anvil");
    expect(result.allowed).toBe(false);
    expect(result.fixed).toHaveLength(0);
    expect(result.violations.some((v) => v.rule === "no-raw-error-format")).toBe(true);
  });

  it("blocks as-any for the model to repair", () => {
    const result = interceptTurn([{ path: "src/a.ts", diff: `+${FIX_AS_ANY}\n` }], "anvil");
    expect(result.allowed).toBe(false);
    expect(result.violations.some((v) => v.rule === "no-as-any")).toBe(true);
  });

  it("auto-fixes two distinct raw-error edits to the SAME path without cross-contamination", () => {
    const A = "const m = err instanceof " + "Error ? err.message : String(err);";
    const B = "const msg = e instanceof " + "Error ? e.message : String(e);";
    const result = interceptTurn(
      [
        { path: "src/a.ts", diff: `${GET_ERROR_MESSAGE_IMPORT}+${A}\n` },
        { path: "src/a.ts", diff: `${GET_ERROR_MESSAGE_IMPORT}+${B}\n` },
      ],
      "anvil"
    );
    expect(result.allowed).toBe(true);
    expect(result.fixed).toHaveLength(2);
    // Positional identity: each fixed entry must record WHICH pending change
    // it belongs to — a path key alone cannot distinguish same-path edits.
    expect(result.fixed.map((f) => f.index)).toEqual([0, 1]);
    expect(result.fixed[0].diff).toContain("getErrorMessage(err)");
    expect(result.fixed[1].diff).toContain("getErrorMessage(e)");
  });

  it("never rewrites a foreign project's error handling into an unresolvable call", () => {
    // The auto-fix emits `getErrorMessage(...)` and does NOT add an import, so in
    // a project without @imitravanu/anvil-core it would produce an undefined identifier.
    const result = interceptTurn([{ path: "src/a.ts", diff: `+${FIX_RAW_ERROR}\n` }], "foreign");
    expect(result.fixed).toHaveLength(0);
    expect(result.allowed).toBe(true);
  });

  it("keeps enforcing custom rules in a foreign project", () => {
    const result = interceptTurn(
      [{ path: "src/a.ts", diff: '+import moment from "moment";\n' }],
      "foreign",
      [{ rule: "no-moment", pattern: /from ["']moment["']/, detail: "Use date-fns instead" }]
    );
    expect(result.allowed).toBe(false);
    expect(result.violations.some((v) => v.rule === "no-moment")).toBe(true);
  });
});

describe("guardianFixedText", () => {
  it("strips diff markers from a repaired diff, preserving clean lines", () => {
    expect(guardianFixedText("+const m = getErrorMessage(err);\n+const y = 1;\n")).toBe(
      "const m = getErrorMessage(err);\nconst y = 1;\n",
    );
  });
});

describe("guardedInit", () => {
  let dir = "";
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-guarded-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("provisions AGENTS.md and allowlist without overwriting", () => {
    const first = guardedInit(dir, "typescript");
    expect(first.created).toContain("AGENTS.md");
    expect(first.created).toContain(".fresh-allowlist.json");
    const second = guardedInit(dir, "typescript");
    expect(second.skipped).toContain("AGENTS.md");
    expect(fs.readFileSync(path.join(dir, "AGENTS.md"), "utf8")).toContain("as " + "any");
  });
});
