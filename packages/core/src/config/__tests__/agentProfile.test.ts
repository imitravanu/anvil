import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ANVIL_BASE_SYSTEM_PROMPT, buildAnvilAgentProfile } from "../agentProfile.js";
import { DEFAULT_MAX_TOKENS } from "../constants.js";

describe("buildAnvilAgentProfile", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-profile-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("uses the shared base prompt when no plugins are supplied", () => {
    const profile = buildAnvilAgentProfile(tmpDir);
    expect(profile.systemPrompt).toContain(ANVIL_BASE_SYSTEM_PROMPT);
  });

  it("folds plugin prompts in after the base prompt, before project rules", () => {
    fs.writeFileSync(path.join(tmpDir, "AGENTS.md"), "Project rule text.", "utf8");

    const profile = buildAnvilAgentProfile(tmpDir, {
      pluginPrompts: ["Plugin one.", "Plugin two."],
    });

    expect(profile.systemPrompt).toContain(ANVIL_BASE_SYSTEM_PROMPT);
    expect(profile.systemPrompt).toContain("Plugin one.");
    expect(profile.systemPrompt).toContain("Plugin two.");
    expect(profile.systemPrompt).toContain("Project rule text.");
    // Order is the contract buildSystemPrompt already guarantees: plugin text
    // joins the base, then rules/memory are appended.
    expect(profile.systemPrompt.indexOf(ANVIL_BASE_SYSTEM_PROMPT)).toBeLessThan(
      profile.systemPrompt.indexOf("Plugin one.")
    );
    expect(profile.systemPrompt.indexOf("Plugin two.")).toBeLessThan(
      profile.systemPrompt.indexOf("Project rule text.")
    );
  });

  it("an empty plugin list does not append separators", () => {
    const profile = buildAnvilAgentProfile(tmpDir, { pluginPrompts: [] });
    expect(profile.systemPrompt).toContain(ANVIL_BASE_SYSTEM_PROMPT);
    expect(profile.systemPrompt).not.toContain("\n\n\n");
  });

  it("defaults maxTokens to the centralized constant", () => {
    expect(buildAnvilAgentProfile(tmpDir).maxTokens).toBe(DEFAULT_MAX_TOKENS);
  });

  it("honors an explicit maxTokens override (eval tasks carry their own)", () => {
    expect(buildAnvilAgentProfile(tmpDir, { maxTokens: 512 }).maxTokens).toBe(512);
  });

  it("defaults autoVerify on — closed-loop verification is product behavior", () => {
    expect(buildAnvilAgentProfile(tmpDir).autoVerify).toBe(true);
  });

  it("honors an explicit autoVerify override (the eval lane's declared boundary)", () => {
    expect(buildAnvilAgentProfile(tmpDir, { autoVerify: false }).autoVerify).toBe(false);
  });

  it("is the only base-prompt source: the constant is what production reads", () => {
    // Guards the Phase 38.1 defect class directly — if someone edits the
    // prompt, every surface moves together because they all resolve here.
    expect(ANVIL_BASE_SYSTEM_PROMPT.startsWith("You are Anvil")).toBe(true);
  });
});
