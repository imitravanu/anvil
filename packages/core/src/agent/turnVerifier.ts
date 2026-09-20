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

  // S1.2: verification and repair-requesting are separate decisions. The
  // final state is ALWAYS verified — budget exhaustion only stops pushing
  // further repair prompts, never testing what the last repair actually did.
  const mayRequestRepair = ctx.verifyRepairsUsed < ctx.maxVerifyRepairs;

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
  }

  yield { type: "verification_result", passed: false, summary: verifyResult.summary };
  ctx.recordLedger({ eventType: "verification_finished", tool: testCmd, outcome: "error", elapsedMs: elapsed });

  if (mayRequestRepair) {
    const repairMsg =
      `[Automated Test Verification Failed]\n` +
      `The test command \`${testCmd}\` failed (exit ${verifyResult.exitCode}):\n` +
      `${verifyResult.failureTrace ?? verifyResult.output}\n\n` +
      `Analyze the test failure, use edit_file or write_file to repair the issue, and ensure the tests pass.`;
    ctx.pushRepairPrompt(repairMsg);
    return { status: "needs_repair" };
  }

  // Budget exhausted AND the final state still fails: say so explicitly.
  yield { type: "verification_gave_up", command: testCmd };
  ctx.recordLedger({ eventType: "verification_gave_up", tool: testCmd, outcome: "error", elapsedMs: 0 });
  return { status: "gave_up" };
}

/**
 * The turn-terminal sequence: verify the final state, then either ask for one
 * more round (`continue` — a repair prompt was pushed) or close the turn with
 * `turn_complete` / an error. Extracted from `AgentSession.send()` so the loop
 * body reads as schedule → dispatch → verify → close, and the ordering of the
 * completion events lives in one place. The caller owns the one mutation this
 * cannot see: `verifyRepairsUsed` must be bumped on `"continue"` before the
 * next round.
 */
export interface TurnCompletionContext {
  projectRoot: string;
  autoVerify: boolean | string | undefined;
  mutationsOccurred: boolean;
  verifyRepairsUsed: number;
  maxVerifyRepairs: number;
  /** `undefined` never reaches here: send() calls this only when a stop
   *  reason exists; the field is optional upstream. `"error"` is the one
   *  value that changes the close (a content/safety block, not a completion). */
  stopReason: string | undefined;
  signal: AbortSignal;
  recordLedger: (entry: Omit<RunLedgerEntry, "seq" | "ts">) => void;
  pushRepairPrompt: (prompt: string) => void;
  /** Provider/model success bookkeeping — resets the circuit breaker. */
  onSuccess: () => void;
}

export type TurnCompletion = { action: "continue" } | { action: "done" };

export async function* finishTurn(
  ctx: TurnCompletionContext
): AsyncGenerator<AgentEvent, TurnCompletion> {
  const vOutcome = yield* verifyTurnMutations({
    projectRoot: ctx.projectRoot,
    autoVerify: ctx.autoVerify,
    mutationsOccurred: ctx.mutationsOccurred,
    verifyRepairsUsed: ctx.verifyRepairsUsed,
    maxVerifyRepairs: ctx.maxVerifyRepairs,
    signal: ctx.signal,
    recordLedger: ctx.recordLedger,
    pushRepairPrompt: ctx.pushRepairPrompt,
  });

  if (vOutcome.status === "cancelled") return { action: "done" };
  if (vOutcome.status === "needs_repair") return { action: "continue" };

  if (ctx.stopReason === "error") {
    yield {
      type: "error",
      message:
        "The model declined to complete this turn (content filter or safety block) — no usable response was produced.",
    };
    return { action: "done" };
  }

  ctx.onSuccess();
  yield { type: "turn_complete" };
  return { action: "done" };
}
