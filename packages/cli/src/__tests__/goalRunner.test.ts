import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { runGoalHeadless } from "../goalRunner.js";
import type { ModelProvider, CompletionRequest, StreamEvent } from "@anvil/core";

class TestFakeProvider implements ModelProvider {
  readonly id = "anthropic" as const;
  readonly displayName = "Test Fake Provider";
  calls: CompletionRequest[] = [];
  constructor(private script: StreamEvent[][]) {}
  isConfigured(): boolean { return true; }
  async *streamCompletion(req: CompletionRequest): AsyncGenerator<StreamEvent> {
    this.calls.push(req);
    const turn = this.script.shift() ?? [];
    for (const ev of turn) yield ev;
  }
}

describe("runGoalHeadless", () => {
  let tmpDir: string;
  let stdoutSpy: any;
  let stderrSpy: any;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-goal-cli-test-"));
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("executes autonomous goal runner and prints summary to stdout", async () => {
    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ name: "goal-test-repo" })
    );

    const planTurn: StreamEvent[] = [
      {
        type: "text_delta",
        text: JSON.stringify([
          { id: "1", title: "Milestone 1", criteria: "Step 1" },
        ]),
      },
      { type: "turn_end", stopReason: "end_turn" },
    ];

    const m1Turn: StreamEvent[] = [
      { type: "text_delta", text: "Milestone 1 complete" },
      { type: "turn_end", stopReason: "end_turn" },
    ];

    // Evidence gate: each milestone turn is followed by an adversarial review
    // that must answer YES for the milestone to count as completed.
    const reviewTurn: StreamEvent[] = [
      { type: "text_delta", text: "YES — criteria satisfied." },
      { type: "turn_end", stopReason: "end_turn" },
    ];

    const critiqueTurn: StreamEvent[] = [
      { type: "text_delta", text: "Critique: Clean execution" },
      { type: "turn_end", stopReason: "end_turn" },
    ];

    const provider = new TestFakeProvider([planTurn, m1Turn, reviewTurn, critiqueTurn]);

    const code = await runGoalHeadless({
      goal: "Implement test feature",
      provider,
      model: "test-model",
      projectRoot: tmpDir,
      autoApprove: true,
      raw: false,
    });

    expect(code).toBe(0);

    const stderrOutput = stderrSpy.mock.calls.map((c: any) => c[0]).join("");
    const stdoutOutput = stdoutSpy.mock.calls.map((c: any) => c[0]).join("");

    expect(stderrOutput).toContain("[Awareness]");
    expect(stderrOutput).toContain("[Goal Plan]");
    expect(stderrOutput).toContain("[Milestone 1]");
    expect(stderrOutput).toContain("[Milestone 1 Completed]");
    expect(stderrOutput).toContain("[Adversarial Self-Critique]");
    expect(stdoutOutput).toContain("=== Mission Summary ===");
  });

  it("suppresses stderr diagnostics when raw is true", async () => {
    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ name: "goal-test-repo" })
    );

    const planTurn: StreamEvent[] = [
      {
        type: "text_delta",
        text: JSON.stringify([
          { id: "1", title: "Milestone 1", criteria: "Step 1" },
        ]),
      },
      { type: "turn_end", stopReason: "end_turn" },
    ];

    const m1Turn: StreamEvent[] = [
      { type: "text_delta", text: "Done" },
      { type: "turn_end", stopReason: "end_turn" },
    ];

    const reviewTurn: StreamEvent[] = [
      { type: "text_delta", text: "YES — done." },
      { type: "turn_end", stopReason: "end_turn" },
    ];

    const critiqueTurn: StreamEvent[] = [
      { type: "text_delta", text: "Critique done" },
      { type: "turn_end", stopReason: "end_turn" },
    ];

    const provider = new TestFakeProvider([planTurn, m1Turn, reviewTurn, critiqueTurn]);

    const code = await runGoalHeadless({
      goal: "Test raw mode",
      provider,
      model: "test-model",
      projectRoot: tmpDir,
      autoApprove: true,
      raw: true,
    });

    expect(code).toBe(0);
    const stderrOutput = stderrSpy.mock.calls.map((c: any) => c[0]).join("");
    expect(stderrOutput).not.toContain("[Awareness]");
    expect(stderrOutput).not.toContain("[Goal Plan]");
  });
});
