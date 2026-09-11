import type { ToolExecutionResult } from "../tools/types.js";
import { describeToolInput, executeTool } from "../tools/index.js";
import { isReadOnlyCommand } from "../tools/bash.js";
import type { AgentEvent } from "./types.js";
import type { RunLedgerEntry } from "./ledger.js";
import type { PreparedCall } from "./loopGuard.js";
import type { PermissionBroker } from "./types.js";

export interface RunnableCall {
  p: PreparedCall;
  startedAt: number;
}

export interface OrchestratorDeps {
  projectRoot: string;
  permissionBroker: PermissionBroker;
  signal: AbortSignal;
  recordLedger: (entry: Omit<RunLedgerEntry, "seq" | "ts">) => void;
}

/**
 * Tool-batch execution: declared parallel policy (any mutating call forces
 * the WHOLE batch serially for single-flight prompts and no file/command
 * races; all-read-only batches run concurrently with results re-ordered).
 * Owns only execution — no history, no TurnState, no checkpoints.
 * `startedAt` timestamps are borrowed from the caller (stamped at
 * classification); re-stamping here would corrupt ledger elapsedMs.
 */
export class ToolOrchestrator {
  constructor(private readonly deps: OrchestratorDeps) {}

  /** Serial iff solo, or any call is mutating (unknown tools count as mutating). */
  isSerialBatch(toRun: readonly RunnableCall[]): boolean {
    return toRun.length <= 1 || toRun.some((t) => t.p.def?.mutating ?? true);
  }

  async *run(
    toRun: readonly RunnableCall[]
  ): AsyncGenerator<AgentEvent, Map<string, ToolExecutionResult>> {
    const runResults = new Map<string, ToolExecutionResult>();
    // Attach abort signal to permission broker so pending prompts are cancelled on abort.
    // Detached in `finally`: without this every tool batch leaked one listener
    // per turn into the broker and the signal.
    this.deps.permissionBroker.attachAbortSignal?.(this.deps.signal);
    try {
      if (this.isSerialBatch(toRun)) {
        yield* this.runSerial(toRun, runResults);
      } else {
        yield* this.runConcurrent(toRun, runResults);
      }
    } finally {
      this.deps.permissionBroker.detachAbortSignal?.(this.deps.signal);
    }
    // The map may be missing entries for calls cut off by abort; the session
    // owns the `cancelled` event and repairs history afterwards — this class
    // owns nothing but tool execution.
    return runResults;
  }

  private async *runSerial(
    toRun: readonly RunnableCall[],
    runResults: Map<string, ToolExecutionResult>
  ): AsyncGenerator<AgentEvent> {
    const { projectRoot, permissionBroker, signal } = this.deps;
    for (const t of toRun) {
      const { call, def } = t.p;
      if (signal.aborted) {
        this.deps.recordLedger({ eventType: "cancelled", tool: call.name, inputHash: t.p.key, outcome: "aborted", elapsedMs: 0 });
        return;
      }
      if (!def) {
        const msg = `Unknown tool: ${call.name}`;
        const result: ToolExecutionResult = { output: { error: msg }, isError: true, summary: msg };
        yield { type: "tool_finished", id: call.id, name: call.name, result };
        this.deps.recordLedger({ eventType: "tool_finished", tool: call.name, inputHash: t.p.key, outcome: "error", elapsedMs: Date.now() - t.startedAt });
        runResults.set(call.id, result);
        continue;
      }
      if (def.mutating) {
        // Read-only safe-list: `ls`, `git status`, `cat` and friends are
        // positively recognized as harmless (no metacharacters, no globs —
        // see isReadOnlyCommand) and skip the prompt; everything else,
        // including anything not positively known, still gates. The ledger
        // records the auto-allow so the bypass is never silent.
        if (call.name === "run_command") {
          const command = (call.input as { command?: unknown } | undefined)?.command;
          if (typeof command === "string" && isReadOnlyCommand(command, projectRoot)) {
            this.deps.recordLedger({ eventType: "tool_auto_allowed", tool: call.name, inputHash: t.p.key, outcome: "ok", elapsedMs: 0 });
            yield { type: "tool_started", id: call.id, name: call.name, input: call.input };
            this.deps.recordLedger({ eventType: "tool_started", tool: call.name, inputHash: t.p.key, outcome: "ok", elapsedMs: 0 });
            let autoResult: ToolExecutionResult;
            try {
              autoResult = await executeTool(call.name, call.input, { projectRoot, signal });
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : String(err);
              autoResult = { output: { error: `Tool execution failed: ${msg}` }, isError: true, summary: `Error: ${msg}` };
            }
            yield { type: "tool_finished", id: call.id, name: call.name, result: autoResult };
            this.deps.recordLedger({ eventType: "tool_finished", tool: call.name, inputHash: t.p.key, outcome: autoResult.isError ? "error" : "ok", elapsedMs: Date.now() - t.startedAt });
            runResults.set(call.id, autoResult);
            continue;
          }
        }
        let summary = `${call.name}`;
        try {
          summary = await describeToolInput(call.name, call.input, {
            projectRoot,
            signal,
          });
        } catch {
          // preview failure must not block the permission flow
        }
        let approved = false;
        {
          // Race the broker against cancel: without this, cancel() during
          // an open prompt hangs the turn until the user answers it.
          approved = await new Promise<boolean>((resolve) => {
            if (signal.aborted) {
              resolve(false);
              return;
            }
            const onAbort = () => resolve(false);
            signal.addEventListener("abort", onAbort, { once: true });
            permissionBroker.requestPermission(def.name, summary).then(
              (v) => {
                signal.removeEventListener("abort", onAbort);
                resolve(v);
              },
              () => {
                signal.removeEventListener("abort", onAbort);
                resolve(false); // a broken broker denies by default
              }
            );
          });
        }
        if (signal.aborted) {
          this.deps.recordLedger({ eventType: "cancelled", tool: call.name, inputHash: t.p.key, outcome: "aborted", elapsedMs: 0 });
          return;
        }
        if (!approved) {
          this.deps.recordLedger({ eventType: "tool_permission_denied", tool: call.name, inputHash: t.p.key, outcome: "denied", elapsedMs: Date.now() - t.startedAt });
          yield { type: "tool_permission_denied", id: call.id, name: call.name };
          runResults.set(call.id, {
            output: { error: "Permission denied by user. The action was NOT performed." },
            isError: true,
            summary: "Permission denied by user.",
          });
          continue;
        }
      }
      yield { type: "tool_started", id: call.id, name: call.name, input: call.input };
      this.deps.recordLedger({ eventType: "tool_started", tool: call.name, inputHash: t.p.key, outcome: "ok", elapsedMs: 0 });
      let result: ToolExecutionResult;
      try {
        result = await executeTool(call.name, call.input, {
          projectRoot,
          signal,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        result = { output: { error: `Tool execution failed: ${msg}` }, isError: true, summary: `Error: ${msg}` };
      }
      yield { type: "tool_finished", id: call.id, name: call.name, result };
      this.deps.recordLedger({ eventType: "tool_finished", tool: call.name, inputHash: t.p.key, outcome: result.isError ? "error" : "ok", elapsedMs: Date.now() - t.startedAt });
      runResults.set(call.id, result);
    }
  }

  private async *runConcurrent(
    toRun: readonly RunnableCall[],
    runResults: Map<string, ToolExecutionResult>
  ): AsyncGenerator<AgentEvent> {
    const { projectRoot, signal } = this.deps;
    if (signal.aborted) {
      for (const t of toRun) {
        this.deps.recordLedger({ eventType: "cancelled", tool: t.p.call.name, inputHash: t.p.key, outcome: "aborted", elapsedMs: 0 });
      }
      return;
    }
    // Concurrent read-only batch — the shared AbortSignal reaches every call.
    for (const t of toRun) {
      yield { type: "tool_started", id: t.p.call.id, name: t.p.call.name, input: t.p.call.input };
      this.deps.recordLedger({ eventType: "tool_started", tool: t.p.call.name, inputHash: t.p.key, outcome: "ok", elapsedMs: 0 });
    }
    const outputs = await Promise.all(
      toRun.map(async (t) => {
        try {
          return await executeTool(t.p.call.name, t.p.call.input, {
            projectRoot,
            signal,
          });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          return { output: { error: `Tool execution failed: ${msg}` }, isError: true, summary: `Error: ${msg}` };
        }
      })
    );
    // Cancelled mid-batch: don't emit post-abort tool_finished events — the
    // session repairs history with synthetic cancelled results from whatever
    // the orchestrator returns (here: nothing completed observably).
    if (signal.aborted) {
      for (const t of toRun) {
        this.deps.recordLedger({ eventType: "cancelled", tool: t.p.call.name, inputHash: t.p.key, outcome: "aborted", elapsedMs: 0 });
      }
      return;
    }
    for (let i = 0; i < toRun.length; i++) {
      const t = toRun[i];
      const result = outputs[i];
      yield { type: "tool_finished", id: t.p.call.id, name: t.p.call.name, result };
      this.deps.recordLedger({ eventType: "tool_finished", tool: t.p.call.name, inputHash: t.p.key, outcome: result.isError ? "error" : "ok", elapsedMs: Date.now() - t.startedAt });
      runResults.set(t.p.call.id, result);
    }
  }
}
