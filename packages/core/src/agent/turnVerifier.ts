import { detectTestCommand, runTestVerification } from "../tools/verifyTests.js";
import type { AgentEvent } from "./types.js";
import type { RunLedgerEntry } from "./ledger.js";

export interface TurnVerificationContext {
  projectRoot: string;
  autoVerify: boolean | string | undefined;
  mutationsOccurred: boolean;
  verifyRepairsUsed: number;
  maxVerifyRepairs: number;
  signal: AbortSignal;
  recordLedger: (entry: Omit<RunLedgerEntry, "seq" | "ts">) => void;
  pushRepairPrompt: (prompt: string) => void;
}

export type TurnVerificationOutcome =
  | { status: "skipped" }
  | { status: "passed" }
  | { status: "needs_repair" }
  | { status: "gave_up" }
  | { status: "cancelled" };

/**
 * Resolve the test command to run based on autoVerify setting and project detection.
 */
export function resolveTestCommand(
  autoVerify: boolean | string | undefined,
  projectRoot: string
): string | null {
  if (typeof autoVerify === "string") {
    return autoVerify;
  }
  if (autoVerify) {
    return detectTestCommand(projectRoot);
  }
  return null;
}

/**
 * Executes closed-loop TDD auto-verification if mutations occurred and auto-verification is active.
 * Yields verification events and returns the outcome status.
 */
export async function* verifyTurnMutations(
  ctx: TurnVerificationContext
): AsyncGenerator<AgentEvent, TurnVerificationOutcome> {
  const testCmd = resolveTestCommand(ctx.autoVerify, ctx.projectRoot);
  if (!testCmd || !ctx.mutationsOccurred) {
    return { status: "skipped" };
  }

  if (ctx.verifyRepairsUsed < ctx.maxVerifyRepairs) {
    yield { type: "verification_started", command: testCmd };
    ctx.recordLedger({ eventType: "verification_started", tool: testCmd, outcome: "ok", elapsedMs: 0 });

    const verifyStart = Date.now();
    const verifyResult = await runTestVerification(
      ctx.projectRoot,
      testCmd,
      undefined,
      ctx.signal
    );
    const elapsed = Date.now() - verifyStart;

    if (ctx.signal.aborted) {
      yield { type: "cancelled" };
      return { status: "cancelled" };
    }

    if (verifyResult.passed) {
      yield { type: "verification_result", passed: true, summary: verifyResult.summary };
      ctx.recordLedger({ eventType: "verification_finished", tool: testCmd, outcome: "ok", elapsedMs: elapsed });
      return { status: "passed" };
    } else {
      yield { type: "verification_result", passed: false, summary: verifyResult.summary };
      ctx.recordLedger({ eventType: "verification_finished", tool: testCmd, outcome: "error", elapsedMs: elapsed });

      const repairMsg =
        `[Automated Test Verification Failed]\n` +
        `The test command \`${testCmd}\` failed (exit ${verifyResult.exitCode}):\n` +
        `${verifyResult.failureTrace ?? verifyResult.output}\n\n` +
        `Analyze the test failure, use edit_file or write_file to repair the issue, and ensure the tests pass.`;
      ctx.pushRepairPrompt(repairMsg);
      return { status: "needs_repair" };
    }
  } else {
    // Repair budget exhausted.
    yield { type: "verification_gave_up", command: testCmd };
    ctx.recordLedger({ eventType: "verification_gave_up", tool: testCmd, outcome: "error", elapsedMs: 0 });
    return { status: "gave_up" };
  }
}
