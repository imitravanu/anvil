import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MAX_CUSTOM_RULES, MAX_CUSTOM_RULE_INPUT_CHARS, isCatastrophicPattern, loadCustomGuardianRules, parseCustomGuardianRules } from "../rules.js";
import { scanTextForSlop } from "../scanner.js";

describe("parseCustomGuardianRules", () => {
  it("parses a guardian:rules block into structured rules", () => {
    const content = [
      "# AGENTS.md",
      "<!-- guardian:rules",
      "no-moment: /from [\"']moment[\"']/ : \"Use date-fns instead\"",
      "no-lodash: /from [\"']lodash[\"']/ : \"Use native methods\"",
      "-->",
    ].join("\n");
    const rules = parseCustomGuardianRules(content);
    expect(rules.map((r) => r.rule)).toEqual(["no-moment", "no-lodash"]);
    expect(rules[0].pattern.test('import x from "moment"')).toBe(true);
    expect(rules[1].detail).toBe("Use native methods");
  });

  it("returns nothing when no block is present", () => {
    expect(parseCustomGuardianRules("plain prose, no rules here")).toEqual([]);
  });

  it("skips malformed lines and invalid patterns without failing", () => {
    const content = [
      "<!-- guardian:rules",
      "not a rule line",
      "bad: /[unterminated/ : \"never valid\"",
      "ok: /plain-token/ : \"fine\"",
      "-->",
    ].join("\n");
    const rules = parseCustomGuardianRules(content);
    expect(rules.map((r) => r.rule)).toEqual(["ok"]);
  });

  it("rejects nested-quantifier patterns that backtrack catastrophically (ReDoS)", () => {
    const content = [
      "<!-- guardian:rules",
      "redos-plus: /^(a+)+$/ : \"catastrophic\"",
      "redos-star: /^(a*)*b/ : \"catastrophic\"",
      "redos-alt: /^(a|a?)+$/ : \"catastrophic\"",
      "redos-wild: /(.*a){12}/ : \"catastrophic\"",
      "ok: /plain-token/ : \"fine\"",
      "-->",
    ].join("\n");
    const rules = parseCustomGuardianRules(content);
    expect(rules.map((r) => r.rule)).toEqual(["ok"]);
  });

  it("never admits a rule that the scanner would run on a hostile line", () => {
    // Pre-fix `^(a+)+$` took ~14s on a 29-char line (exponential). It must not
    // reach the scanner at all, so the hostile line is never evaluated against it.
    const content = `<!-- guardian:rules\nslow: /^(a+)+$/ : "catastrophic"\n-->`;
    expect(parseCustomGuardianRules(content)).toEqual([]);
  });

  it("bounds the text a custom rule is evaluated against in the scanner", () => {
    const content = `<!-- guardian:rules\nmark: /NEEDLE/ : "found"\n-->`;
    const rules = parseCustomGuardianRules(content);
    const scope = "foreign" as const;
    // Inside the cap: the rule fires.
    const inside = "x".repeat(10) + "NEEDLE";
    expect(scanTextForSlop("a.txt", inside, scope, rules).some((v) => v.rule === "mark")).toBe(true);
    // Past the cap: the rule never sees it, so no unbounded per-line work.
    const beyond = "x".repeat(MAX_CUSTOM_RULE_INPUT_CHARS + 10) + "NEEDLE";
    const started = Date.now();
    expect(scanTextForSlop("a.txt", beyond, scope, rules).some((v) => v.rule === "mark")).toBe(false);
    expect(Date.now() - started).toBeLessThan(500);
  });

  it("classifies nested-quantifier shapes as catastrophic and ordinary rules as safe", () => {
    for (const bad of ["^(a+)+$", "^(a*)*b", "(a|a?)+", "(.*a){12}", "((ab)+)+"]) {
      expect(isCatastrophicPattern(bad), bad).toBe(true);
    }
    for (const ok of ["from ['\"]moment['\"]", "plain-token", "(ab)+", "a+b*c?", "[(]+", "\\(a+\\)+", "(?:x|y)"]) {
      expect(isCatastrophicPattern(ok), ok).toBe(false);
    }
  });

  it("caps the number of parsed rules", () => {
    const lines = Array.from({ length: MAX_CUSTOM_RULES + 10 }, (_, i) => `r${i}: /x${i}/ : "d"`);
    const content = `<!-- guardian:rules\n${lines.join("\n")}\n-->`;
    expect(parseCustomGuardianRules(content).length).toBe(MAX_CUSTOM_RULES);
  });
});

describe("ambiguous-alternation ReDoS family (2026-10-14)", () => {
  it("flags a quantified group whose alternatives overlap", () => {
    // One branch can consume a prefix the other could also consume, so the
    // repetition has no unique parse and backtracks exponentially.
    for (const bad of ["^(a|aa)+$", "(\\w|\\w\\w)+$", "(a|aa)+", "(get|getters)+", "(a|a)+", "(a|)+", "(?:a|aa)+", "(?:foo|foobar)+"]) {
      expect(isCatastrophicPattern(bad), bad).toBe(true);
    }
    // Disjoint branches have exactly one parse; they must stay allowed.
    for (const ok of ["(foo|bar)+", "(a|b)+", "(?:x|y)", "(ab)+", "from ['\"]moment['\"]"]) {
      expect(isCatastrophicPattern(ok), ok).toBe(false);
    }
  });

  it("refuses an ambiguous-alternation rule at parse time", () => {
    const content = `<!-- guardian:rules
slowline: /(\\w|\\w\\w)+$/ : "lines must end in a word character"
-->`;
    expect(parseCustomGuardianRules(content)).toEqual([]);
  });

  it("a hostile project AGENTS.md cannot hang the load-then-scan path", () => {
    // Pre-fix this same rule needed 36s on a 47-char line and >45s on a 61-char
    // one, so the assertion below failed by timeout rather than by value.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-hostile-rules-"));
    try {
      fs.writeFileSync(
        path.join(root, "AGENTS.md"),
        `# project rules

<!-- guardian:rules
slowline: /^(a|aa)+$/ : "line must be all a's"
-->
`
      );
      const rules = loadCustomGuardianRules(root);
      expect(rules).toEqual([]);
      const started = Date.now();
      expect(scanTextForSlop("f.ts", "a".repeat(60) + "b", "foreign" as const, rules)).toEqual([]);
      expect(Date.now() - started).toBeLessThan(1000);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
