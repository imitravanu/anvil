import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runEvalTask } from "../runner.js";
import { armProfileOverride, type AbArm } from "../experiment.js";
import { DEFAULT_MAX_TOKENS, EVAL_AB_MAX_TOKENS } from "../../config/constants.js";
import { ANVIL_BASE_SYSTEM_PROMPT } from "../../config/agentProfile.js";
import type { EvalTask } from "../types.js";

/**
 * A6 — OBSERVE THE SEAM INSTEAD OF ASSERTING IT EXISTS
 *
 * The 38.4 seam test ran against a nonexistent fixture and accepted any throw
 * (`.catch … expect(result).toBeDefined()`), so a missing or wrong profile
 * merge was invisible. This file mocks AgentSession — the seam's endpoint —
 * and reads the resolved session options back out: budget parity (A1) and
 * prompt routing become observable assertions instead of probabilities.
 */

const captured = vi.hoisted(
  () => [] as Array<{ systemPrompt?: string; maxTokens?: number }>
);

vi.mock("../../agent/session.js", () => ({
  AgentSession: class {
    constructor(_provider: unknown, options: { systemPrompt?: string; maxTokens?: number }) {
      captured.push(options);
    }
    async *send(): AsyncGenerator<{ type: string }> {
      yield { type: "done" };
    }
    cancel(): void {
      // no in-flight stream to cancel
    }
  },
}));

function probeTask(overrides: Partial<EvalTask> = {}): EvalTask {
  const setupDir = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-seam-"));
  return {
    id: "seam-probe",
    name: "seam probe",
    category: "bugfix",
    prompt: "no-op",
    timeoutMs: 5_000,
    taskDir: setupDir,
    setupDir,
    assertionScript: path.join(setupDir, "missing-check.sh"),
    ...overrides,
  };
}

const BASELINE: AbArm = {
  name: "baseline",
  profile: { systemPrompt: "PROMPT_BASE" },
};

describe("the A/B profile seam is observed in the resolved session (A6)", () => {
  it("passes the task's own budget through when the arm sets none (A1 parity)", async () => {
    await runEvalTask(probeTask({ maxTokens: 1234 }), {
      useMock: true,
      profile: armProfileOverride(BASELINE),
    });
    const options = captured[captured.length - 1];
    expect(options?.maxTokens).toBe(1234);
    expect(options?.systemPrompt).toBe("PROMPT_BASE");
  });

  it("falls back to DEFAULT_MAX_TOKENS when the task declares no budget either", async () => {
    await runEvalTask(probeTask(), { useMock: true, profile: armProfileOverride(BASELINE) });
    const options = captured[captured.length - 1];
    expect(options?.maxTokens).toBe(DEFAULT_MAX_TOKENS);
  });

  it("applies the arm's explicit budget only with the EVAL_AB_MAX_TOKENS floor", async () => {
    await runEvalTask(probeTask({ maxTokens: 1234 }), {
      useMock: true,
      profile: armProfileOverride({ name: "tiny", profile: { maxTokens: 1_000 } }),
    });
    const options = captured[captured.length - 1];
    expect(options?.maxTokens).toBe(EVAL_AB_MAX_TOKENS);
    // The arm set no prompt, so the shipping one applies through the same seam.
    expect(options?.systemPrompt).toBe(ANVIL_BASE_SYSTEM_PROMPT);
  });

  it("keeps the shipping profile untouched when NO override is supplied", async () => {
    await runEvalTask(probeTask({ maxTokens: 1234 }), { useMock: true });
    const options = captured[captured.length - 1];
    expect(options?.maxTokens).toBe(1234);
    expect(options?.systemPrompt).toBe(ANVIL_BASE_SYSTEM_PROMPT);
  });
});
