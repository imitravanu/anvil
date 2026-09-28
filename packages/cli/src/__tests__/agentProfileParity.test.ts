import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * AGENT PROFILE PARITY GUARD
 *
 * Phase 38.1 measured a live 24/25 for an agent no user runs: the eval lane
 * carried its own system prompt and its own output budget, so the number on
 * record described neither the TUI nor headless. The class of defect is
 * "a call site re-invents part of the agent's identity."
 *
 * These assertions are mechanical so the class cannot recur. They read source
 * as text (the docTruth precedent) because the failure is a *drift between
 * call sites*, which no unit test of the shared module can observe.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../");

/** Every surface that builds a real `AgentSession` for a user. */
const CALL_SITES = [
  "packages/cli/src/index.tsx",
  "packages/cli/src/headless.ts",
  "packages/core/src/eval/runner.ts",
] as const;

const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), "utf-8");

/** 1-based line numbers in `source` matching `pattern`. */
function linesMatching(source: string, pattern: RegExp): number[] {
  const found: number[] = [];
  source.split("\n").forEach((line, i) => {
    if (pattern.test(line)) found.push(i + 1);
  });
  return found;
}

describe("agent profile parity", () => {
  it("every call site routes through buildAnvilAgentProfile", () => {
    const missing = CALL_SITES.filter((rel) => !read(rel).includes("buildAnvilAgentProfile"));
    expect(
      missing,
      `These call sites do not use the shared profile: ${missing.join(", ")}. ` +
        "Construct the agent with buildAnvilAgentProfile() so the prompt, " +
        "output budget, and verify flag cannot drift.",
    ).toEqual([]);
  });

  it("no call site hardcodes a system prompt string literal", () => {
    const offenders: string[] = [];
    for (const rel of CALL_SITES) {
      // A quoted value assigned to systemPrompt, or an assignment at all.
      const hits = linesMatching(
        read(rel),
        /systemPrompt\s*[:=]\s*["'`]|systemPrompt\s*[:=]\s*$/m,
      );
      for (const line of hits) offenders.push(`${rel}:${line}`);
    }
    expect(
      offenders,
      `A call site re-hardcoded the system prompt:\n${offenders.join("\n")}\n` +
        "Use ANVIL_BASE_SYSTEM_PROMPT via buildAnvilAgentProfile().",
    ).toEqual([]);
  });

  it("no call site hardcodes a maxTokens number", () => {
    const offenders: string[] = [];
    for (const rel of CALL_SITES) {
      for (const line of linesMatching(read(rel), /maxTokens\s*:\s*\d+/)) {
        offenders.push(`${rel}:${line}`);
      }
    }
    expect(
      offenders,
      `A call site re-hardcoded the output budget:\n${offenders.join("\n")}\n` +
        "Use DEFAULT_MAX_TOKENS (or an explicit task override) via " +
        "buildAnvilAgentProfile().",
    ).toEqual([]);
  });

  it("the shared constant exists and the eval lane uses the same owner", () => {
    const profile = read("packages/core/src/config/agentProfile.ts");
    expect(profile).toContain("export const ANVIL_BASE_SYSTEM_PROMPT");
    // The eval lane must not be special-cased back to its own prompt.
    expect(read("packages/core/src/eval/runner.ts")).toContain(
      "buildAnvilAgentProfile(tempDir",
    );
  });
});
