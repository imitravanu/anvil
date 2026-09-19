import { describe, expect, it } from "vitest";
import { MAX_CUSTOM_RULES, parseCustomGuardianRules } from "../rules.js";

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

  it("caps the number of parsed rules", () => {
    const lines = Array.from({ length: MAX_CUSTOM_RULES + 10 }, (_, i) => `r${i}: /x${i}/ : "d"`);
    const content = `<!-- guardian:rules\n${lines.join("\n")}\n-->`;
    expect(parseCustomGuardianRules(content).length).toBe(MAX_CUSTOM_RULES);
  });
});
