import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { runEvalTask } from "../runner.js";
import { createVerifyRepairProvider } from "../scriptedVerifyProvider.js";
import { getErrorMessage } from "../../errors.js";
import type { EvalTask } from "../types.js";

/**
 * PHASE 38.8 — DOES THE VERIFY-OFF HARNESS HIDE FAILURES?
 *
 * The eval lane runs `autoVerify: false` by deliberate choice (a repair loop
 * changes the trajectory and can mask the asserted failure — ROADMAP §4), but
 * the cost of that choice was asserted, never measured. This fixture makes the
 * measurement deterministic through the REAL session path (AgentSession →
 * turnVerifier → repair prompt → second provider call):
 *
 *   scripted provider, act 1 → writes `sum = (a, b) => a - b` and declares done
 *   scripted provider, act 2 → writes the fix, ONLY after seeing the automated
 *                              verification feedback in history
 *
 * If the boundary hides failures, the SAME task must grade FALSE with
 * autoVerify off and TRUE with autoVerify on. Anything else would mean the
 * omission is free.
 */

const BUGGY = "export const sum = (a, b) => a - b;\n";
const FIXED = "export const sum = (a, b) => a + b;\n";

describe("Phase 38.8 — the autoVerify axis, measured", () => {
  let tmpDir: string;
  let task: EvalTask;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-verify-axis-"));
    const taskDir = path.join(tmpDir, "verify-repair");
    const setupDir = path.join(taskDir, "setup");
    const assertionsDir = path.join(taskDir, "assertions");
    fs.mkdirSync(setupDir, { recursive: true });
    fs.mkdirSync(assertionsDir, { recursive: true });

    fs.writeFileSync(
      path.join(taskDir, "task.json"),
      JSON.stringify({
        name: "verify-repair",
        category: "bugfix",
        prompt: "Implement sum(a, b) in sum.mjs.",
        timeoutMs: 60_000,
        fast: true,
      })
    );

    // A real, detectable test command: detectTestCommand finds this
    // package.json and resolves `npm test`, exactly as shipping does.
    fs.writeFileSync(
      path.join(setupDir, "package.json"),
      JSON.stringify({
        name: "verify-repair-fixture",
        private: true,
        scripts: { test: "node check.mjs" },
      })
    );
    fs.writeFileSync(
      path.join(setupDir, "check.mjs"),
      [
        'import fs from "node:fs";',
        'const src = fs.existsSync("sum.mjs") ? fs.readFileSync("sum.mjs", "utf8") : "";',
        'if (src.includes("a + b")) { console.log("ok"); process.exit(0); }',
        'console.error("sum.mjs does not implement addition");',
        "process.exit(1);",
        "",
      ].join("\n")
    );

    const checkScript = path.join(assertionsDir, "check.sh");
    fs.writeFileSync(checkScript, '#!/bin/bash\ngrep -q "a + b" sum.mjs\nexit $?\n');
    fs.chmodSync(checkScript, 0o755);

    task = {
      id: "verify-repair",
      name: "verify-repair",
      category: "bugfix",
      prompt: "Implement sum(a, b) in sum.mjs.",
      timeoutMs: 60_000,
      fast: true,
      taskDir,
      setupDir,
      assertionScript: checkScript,
    };
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (err) {
      // Temp-dir cleanup is best-effort; a leftover dir fails nothing.
      void getErrorMessage(err);
    }
  });

  const script = {
    buggyFiles: [{ path: "sum.mjs", content: BUGGY }],
    fixedFiles: [{ path: "sum.mjs", content: FIXED }],
  };

  it("verify OFF grades the same repairable failure as a task failure", async () => {
    const result = await runEvalTask(task, {
      provider: createVerifyRepairProvider(script),
      profile: { autoVerify: false },
    });
    expect(result.passed).toBe(false);
    // One write, no repair: the session never observed the failure.
    expect(result.toolCalls).toBe(1);
  }, 60_000);

  it("verify ON repairs the SAME failure through the shipping session path", async () => {
    const result = await runEvalTask(task, {
      provider: createVerifyRepairProvider(script),
      profile: { autoVerify: true },
    });
    expect(result.error).toBeUndefined();
    expect(result.passed).toBe(true);
    // The repair turn wrote the fix: exactly one extra tool call.
    expect(result.toolCalls).toBe(2);
  }, 60_000);

  it("the scripted provider never writes the fix without verification feedback", async () => {
    // Fail-first for the instrument itself: if history plumbing ever stops
    // carrying the repair prompt, the provider must keep ending turns rather
    // than record a magic pass.
    const provider = createVerifyRepairProvider(script);
    const req = {
      model: "scripted",
      systemPrompt: "",
      tools: [],
      maxTokens: 100,
    };
    for await (const e of provider.streamCompletion({ ...req, messages: [] })) void e;
    const second: Array<{ type: string }> = [];
    for await (const e of provider.streamCompletion({ ...req, messages: [] })) {
      second.push(e as { type: string });
    }
    // No repair feedback in history → no fix: the turn just ends.
    expect(second.some((e) => e.type === "tool_call_start")).toBe(false);
    expect(second.at(-1)).toEqual({ type: "turn_end", stopReason: "end_turn" });
  });
});
