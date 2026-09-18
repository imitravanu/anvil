import { describe, it, expect, vi } from "vitest";
import { resolveTestCommand, verifyTurnMutations } from "../turnVerifier.js";
import type { TurnVerificationContext } from "../turnVerifier.js";
import type { AgentEvent } from "../types.js";

describe("turnVerifier", () => {
  it("resolves custom test command or detects from project root", () => {
    expect(resolveTestCommand("npm test", "/tmp")).toBe("npm test");
    expect(resolveTestCommand(false, "/tmp")).toBeNull();
    expect(resolveTestCommand(undefined, "/tmp")).toBeNull();
  });

  it("skips verification when no mutations occurred or autoVerify disabled", async () => {
    const ctx: TurnVerificationContext = {
      projectRoot: "/tmp",
      autoVerify: "npm test",
      mutationsOccurred: false,
      verifyRepairsUsed: 0,
      maxVerifyRepairs: 3,
      signal: new AbortController().signal,
      recordLedger: vi.fn(),
      pushRepairPrompt: vi.fn(),
    };

    const gen = verifyTurnMutations(ctx);
    const result = await gen.next();
    expect(result.done).toBe(true);
    expect(result.value).toEqual({ status: "skipped" });
  });

  it("executes passing verification command", async () => {
    const events: AgentEvent[] = [];
    const ctx: TurnVerificationContext = {
      projectRoot: process.cwd(),
      autoVerify: "echo 'all passed' && exit 0",
      mutationsOccurred: true,
      verifyRepairsUsed: 0,
      maxVerifyRepairs: 3,
      signal: new AbortController().signal,
      recordLedger: vi.fn(),
      pushRepairPrompt: vi.fn(),
    };

    const gen = verifyTurnMutations(ctx);
    let item = await gen.next();
    while (!item.done) {
      events.push(item.value);
      item = await gen.next();
    }

    expect(item.value).toEqual({ status: "passed" });
    expect(events.map((e) => e.type)).toEqual(["verification_started", "verification_result"]);
    expect((events[1] as { passed: boolean }).passed).toBe(true);
    expect(ctx.recordLedger).toHaveBeenCalledTimes(2);
  });

  it("handles failing verification and requests repair", async () => {
    const events: AgentEvent[] = [];
    const ctx: TurnVerificationContext = {
      projectRoot: process.cwd(),
      autoVerify: "echo 'test failure details' && exit 1",
      mutationsOccurred: true,
      verifyRepairsUsed: 0,
      maxVerifyRepairs: 3,
      signal: new AbortController().signal,
      recordLedger: vi.fn(),
      pushRepairPrompt: vi.fn(),
    };

    const gen = verifyTurnMutations(ctx);
    let item = await gen.next();
    while (!item.done) {
      events.push(item.value);
      item = await gen.next();
    }

    expect(item.value).toEqual({ status: "needs_repair" });
    expect(events.map((e) => e.type)).toEqual(["verification_started", "verification_result"]);
    expect((events[1] as { passed: boolean }).passed).toBe(false);
    expect(ctx.pushRepairPrompt).toHaveBeenCalledWith(
      expect.stringContaining("[Automated Test Verification Failed]")
    );
  });

  it("always verifies the final state when the repair budget is exhausted (S1.2)", async () => {
    // Deliberate semantic change: budget exhaustion must stop REQUESTING
    // repairs, never stop VERIFYING. The last repair's result must be tested
    // — otherwise the turn completes unverified after a mutation.
    const events: AgentEvent[] = [];
    const ctx: TurnVerificationContext = {
      projectRoot: process.cwd(),
      autoVerify: "echo 'failed' && exit 1",
      mutationsOccurred: true,
      verifyRepairsUsed: 3,
      maxVerifyRepairs: 3,
      signal: new AbortController().signal,
      recordLedger: vi.fn(),
      pushRepairPrompt: vi.fn(),
    };

    const gen = verifyTurnMutations(ctx);
    let item = await gen.next();
    while (!item.done) {
      events.push(item.value);
      item = await gen.next();
    }

    expect(item.value).toEqual({ status: "gave_up" });
    expect(events.map((e) => e.type)).toEqual([
      "verification_started",
      "verification_result",
      "verification_gave_up",
    ]);
    expect((events[1] as { passed: boolean }).passed).toBe(false);
    expect(ctx.pushRepairPrompt).not.toHaveBeenCalled();
  });

  it("reports passed when the final state verifies after repairs are exhausted (S1.2)", async () => {
    // A successful repair on the last allowed attempt must be verified and
    // reported as passed — not silently classified as gave_up.
    const events: AgentEvent[] = [];
    const ctx: TurnVerificationContext = {
      projectRoot: process.cwd(),
      autoVerify: "echo 'all passed' && exit 0",
      mutationsOccurred: true,
      verifyRepairsUsed: 3,
      maxVerifyRepairs: 3,
      signal: new AbortController().signal,
      recordLedger: vi.fn(),
      pushRepairPrompt: vi.fn(),
    };

    const gen = verifyTurnMutations(ctx);
    let item = await gen.next();
    while (!item.done) {
      events.push(item.value);
      item = await gen.next();
    }

    expect(item.value).toEqual({ status: "passed" });
    expect(events.map((e) => e.type)).toEqual(["verification_started", "verification_result"]);
  });
});
