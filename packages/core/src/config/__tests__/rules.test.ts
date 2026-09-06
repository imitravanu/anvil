import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  loadProjectRules,
  buildSystemPrompt,
  MAX_RULES_BYTES,
} from "../rules.js";

describe("loadProjectRules", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-rules-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns null when no rule candidates exist", () => {
    expect(loadProjectRules(tmpDir)).toBeNull();
  });

  it("loads .anvil/rules when present", () => {
    const anvilDir = path.join(tmpDir, ".anvil");
    fs.mkdirSync(anvilDir, { recursive: true });
    fs.writeFileSync(path.join(anvilDir, "rules"), "Follow strict TDD.", "utf8");

    const rules = loadProjectRules(tmpDir);
    expect(rules).not.toBeNull();
    expect(rules?.source).toBe(".anvil/rules");
    expect(rules?.content).toBe("Follow strict TDD.");
  });

  it("respects precedence: .anvil/rules > AGENTS.md > .cursorrules", () => {
    const anvilDir = path.join(tmpDir, ".anvil");
    fs.mkdirSync(anvilDir, { recursive: true });
    fs.writeFileSync(path.join(anvilDir, "rules"), "Rule 1", "utf8");
    fs.writeFileSync(path.join(tmpDir, "AGENTS.md"), "Rule 2", "utf8");
    fs.writeFileSync(path.join(tmpDir, ".cursorrules"), "Rule 3", "utf8");

    expect(loadProjectRules(tmpDir)?.source).toBe(".anvil/rules");
    expect(loadProjectRules(tmpDir)?.content).toBe("Rule 1");

    fs.rmSync(path.join(anvilDir, "rules"));
    expect(loadProjectRules(tmpDir)?.source).toBe("AGENTS.md");
    expect(loadProjectRules(tmpDir)?.content).toBe("Rule 2");

    fs.rmSync(path.join(tmpDir, "AGENTS.md"));
    expect(loadProjectRules(tmpDir)?.source).toBe(".cursorrules");
    expect(loadProjectRules(tmpDir)?.content).toBe("Rule 3");
  });

  it("skips empty rule files and checks the next candidate", () => {
    fs.writeFileSync(path.join(tmpDir, "AGENTS.md"), "   \n  ", "utf8");
    fs.writeFileSync(path.join(tmpDir, ".cursorrules"), "Valid rules", "utf8");

    const rules = loadProjectRules(tmpDir);
    expect(rules?.source).toBe(".cursorrules");
    expect(rules?.content).toBe("Valid rules");
  });

  it("truncates rules exceeding MAX_RULES_BYTES (16KB)", () => {
    const largeContent = "x".repeat(MAX_RULES_BYTES + 500);
    fs.writeFileSync(path.join(tmpDir, "AGENTS.md"), largeContent, "utf8");

    const rules = loadProjectRules(tmpDir);
    expect(rules).not.toBeNull();
    expect(rules?.source).toBe("AGENTS.md");
    expect(rules?.content.length).toBe(MAX_RULES_BYTES + "\n[rules truncated at 16KB]".length);
    expect(rules?.content.endsWith("[rules truncated at 16KB]")).toBe(true);
  });
});

describe("buildSystemPrompt", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-prompt-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns base prompt unmodified if no rules exist", () => {
    const base = "Base system prompt.";
    expect(buildSystemPrompt(base, tmpDir)).toBe(base);
  });

  it("augments system prompt with project rules", () => {
    fs.writeFileSync(path.join(tmpDir, "AGENTS.md"), "Use Vitest only.", "utf8");
    const base = "Base system prompt.";
    const result = buildSystemPrompt(base, tmpDir);

    expect(result).toContain("Base system prompt.");
    expect(result).toContain("[Project-specific rules from AGENTS.md]");
    expect(result).toContain("Use Vitest only.");
  });
});
