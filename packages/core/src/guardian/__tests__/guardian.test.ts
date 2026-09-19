import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { scanTextForSlop, scanDiffForSlop } from "../scanner.js";
import { autoFixRawErrorFormat, guardianFixedText, interceptTurn } from "../interceptor.js";
import { detectGuardianScope } from "../scope.js";
import { guardedInit } from "../init.js";

// Fixture patterns are concatenated so this test source never contains a
// literal slop pattern (the gate scans added lines); runtime values are exact.
const FIX_AS_ANY = "const x = foo as " + "any;";
const FIX_RAW_ERROR = "const m = err instanceof " + "Error ? err.message : String(err);";
// The scanner flags this raw-error ternary shape, but the safe auto-fix
// cannot rewrite it — its fallback is not String(...).
const FIX_RAW_ERROR_UNFIXABLE =
  "const m = err instanceof " + "Error ? err.message : JSON.stringify(err);";
const FIX_EMPTY_CATCH = "try { run(); } catch " + "{}";
// Split for the same reason: this repo's gate flags these tokens in added lines.
const PLACEHOLDER_WORD = "TO" + "DO";
const TUI_IMPORT = 'import x from "@anvil/' + 'tui";';

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

  it("flags empty catch blocks", () => {
    const violations = scanTextForSlop("src/a.ts", FIX_EMPTY_CATCH, "anvil");
    expect(violations.some((v) => v.rule === "no-empty-catch")).toBe(true);
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
    // `anvil gate` passes a synthetic "(working tree)" label; classifying that as
    // non-code would silently disable the working-tree scan entirely.
    expect(scanTextForSlop("(working tree)", FIX_AS_ANY, "anvil").some((v) => v.rule === "no-as-any")).toBe(true);
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

  it("recognises a project whose core workspace is @anvil/core", () => {
    fs.mkdirSync(path.join(dir, "packages", "core"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "packages", "core", "package.json"),
      JSON.stringify({ name: "@anvil/core" })
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

  it("auto-fixes raw error formatting", () => {
    const result = interceptTurn([{ path: "src/a.ts", diff: `+${FIX_RAW_ERROR}\n` }], "anvil");
    expect(result.allowed).toBe(true);
    expect(result.fixed).toHaveLength(1);
    expect(result.fixed[0].diff).toContain("getErrorMessage(err)");
    // The repaired violation is reported as autofixed, not silently dropped.
    expect(result.autofixed).toHaveLength(1);
    expect(result.autofixed[0].autofixed).toBe(true);
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
        { path: "src/a.ts", diff: `+${A}\n` },
        { path: "src/a.ts", diff: `+${B}\n` },
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
    // a project without @anvil/core it would produce an undefined identifier.
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
