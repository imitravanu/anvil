import { randomUUID } from "node:crypto";
import { ConversationMessage, ModelProvider, StreamEvent } from "../providers/types.js";
import { getModel } from "../providers/registry.js";
import { TOOL_DEFINITIONS, detectTestCommand, runTestVerification } from "../tools/index.js";
import type { ToolExecutionResult, ToolDefinition } from "../tools/types.js";
import { COMPACTION_THRESHOLD, KEEP_RECENT_MESSAGES, compactIfNeeded, estimateTokens } from "./compaction.js";
import { SessionMetadata, StoredSession } from "../session/types.js";
import { AgentEvent, AgentOptions, DEFAULT_MAX_INNER_ITERATIONS } from "./types.js";
import { RunLedgerEntry, capLedger, maxSeq } from "./ledger.js";
import { clearRateLimitRecord, getConsecutiveRateLimitCount, isCircuitOpen, isRateLimitMessage, noteRateLimited, rateLimitRetrySeconds, recordFailure, recordSuccess } from "../providers/freeModels.js";
import { MAX_DELEGATIONS_PER_TURN, runSubAgentLive } from "./subagent.js";
import { TurnState } from "./turnState.js";
import { LoopGuard, type AccumulatedToolCall, type PreparedCall } from "./loopGuard.js";
import { ToolOrchestrator, type RunnableCall } from "./orchestrator.js";
import { HistoryStore } from "./historyStore.js";
import {
  Checkpoint,
  summarizeSessionChanges,
  type SessionFileChange,
  capCheckpoints,
  checkpointMeta,
  takeSnapshot,
  restoreCheckpoint,
  type CheckpointMeta,
} from "./checkpoints.js";
import { loadCheckpoints, saveCheckpointsAsync } from "./checkpointStore.js";

/**
 * Abortable wait for the automatic rate-limit retry. Rejects on abort so the
 * turn resolves as cancelled instead of waking up and hammering a rate-limited
 * endpoint after the user asked to stop.
 */
function sleepAbortable(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("aborted"));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export const MAX_VERIFY_REPAIRS = 2;

export interface RestoreData {
  metadata: SessionMetadata;
  history: ConversationMessage[];
}

export class AgentSession {
  private history = new HistoryStore();
  private currentController: AbortController | null = null;
  private isSending = false;
  private provider: ModelProvider;
  private options: AgentOptions;
  // The previous turn's input token count — compaction uses it reactively
  //.
  private lastInputTokens = 0;
  // durable-loop state.
  readonly maxInnerIterations: number;
  /** Current plan, set by the update_plan tool; persists on save. */
  plan: string | null = null;
  private ledger: RunLedgerEntry[] = [];
  private ledgerSeq = 0;
  private lastUsage: { inputTokens: number; outputTokens: number } | null = null;
  // resolved tool list (sub-agents exclude delegate_task; MCP seam).
  // Per-turn counters (iterations, delegations, loop streaks) live in
  // TurnState, fresh per send() — never as session fields.
  private toolDefs: ToolDefinition[];
  // Rewind: in-memory ring of pre-mutation file snapshots (never persisted).
  private checkpoints: Checkpoint[] = [];
  private checkpointSeq = 0;
  readonly id: string;
  title: string | null; // null until the first user message sets a default
  readonly createdAt: string;

  constructor(
    provider: ModelProvider,
    options: AgentOptions,
    restore?: RestoreData
  ) {
    this.provider = provider;
    // delegation is ON unless explicitly disabled (sub-agents pass
    // false — the real depth guard; a filtered tool list only stops a
    // well-behaved model).
    this.options = { ...options, allowDelegation: options.allowDelegation ?? true };
    this.maxInnerIterations = options.maxInnerIterations ?? DEFAULT_MAX_INNER_ITERATIONS;
    // tool-list override (sub-agents exclude delegate_task; MCP seam).
    this.toolDefs = options.tools ?? TOOL_DEFINITIONS;
    this.id = restore?.metadata.id ?? randomUUID();
    this.title = restore?.metadata.title ?? null;
    this.createdAt = restore?.metadata.createdAt ?? new Date().toISOString();
    if (restore) {
      this.history = new HistoryStore(restore.history);
      this.plan = restore.metadata.plan ?? null;
      this.ledger = capLedger(restore.metadata.runLedger ?? []);
      this.ledgerSeq = maxSeq(this.ledger);
      // Persistent rewind ring: resumed sessions keep their undo history.
      this.checkpoints = loadCheckpoints(this.id);
      this.checkpointSeq = this.checkpoints.reduce((m, cp) => Math.max(m, cp.id), 0);
      // Proactive compaction seed: a resumed session has no measured usage,
      // so the reactive loop-top check would sail past an oversized history
      // and the first request would die on the provider's context limit.
      // The estimate is a floor; the first real usage event replaces it.
      this.lastInputTokens = estimateTokens(restore.history);
    }
  }

  /** Project root the session operates on (for /diff review). */
  get projectRoot(): string {
    return this.options.projectRoot;
  }

  /**
   * /diff review: file changes this session made, diffed against the
   * pre-change snapshots. Contents never leave the session — the caller
   * gets finished diffs, not snapshot bytes.
   */
  summarizeChanges(): Promise<SessionFileChange[]> {
    return summarizeSessionChanges(this.options.projectRoot, this.checkpoints);
  }

  /** Read-only view of the conversation history (exposed for tests / future phases). */
  getHistory(): readonly ConversationMessage[] {
    return this.history.get();
  }

  cancel(): void {
    this.currentController?.abort();
  }

  /**
   * Hot-swap the tool list (MCP reconnect). Rejected mid-turn: the batch in
   * flight classified against the old list, and mixing would corrupt the
   * declared-order replay. The /mcp handler busy-guards anyway; this is the
   * session-side guarantee.
   */
  setTools(defs: readonly ToolDefinition[]): void {
    if (this.isSending) {
      throw new Error("Cannot change tools while a turn is in progress.");
    }
    this.toolDefs = [...defs];
  }

  /**
   * Switch the active provider/model mid-session. A provider CHANGE clears
   * history: providerMetadata on tool calls (e.g. Gemini thoughtSignature) is
   * vendor-opaque and must never be replayed through a different adapter.
   * A same-provider model change keeps history.
   */
  switchModel(provider: ModelProvider, model: string): { historyCleared: boolean } {
    const providerChanged = provider.id !== this.provider.id;
    this.provider = provider;
    this.options = { ...this.options, model };
    if (providerChanged) {
      this.history.clear();
      // Token/compaction bookkeeping belongs to the discarded history's
      // provider: stale counts would misfire the next compaction check.
      this.lastInputTokens = 0;
      this.lastUsage = null;
    }
    return { historyCleared: providerChanged };
  }

  /**
   * /retry: drop the last user turn (plus its answer and any tool exchange
   * after it) and return the request text for re-sending. Null if nothing
   * to unwind.
   */
  popLastUserTurn(): string | null {
    return this.history.popLastUserTurn();
  }

  /** Wipe conversation history (the `/clear` command). */
  clearHistory(): void {
    this.history.clear();
    this.lastInputTokens = 0;
    this.lastUsage = null;
  }

  /** Snapshot for persistence — the CLI decides when to call saveSession(). */
  toStoredSession(providerId: string, model: string): StoredSession {
    return {
      metadata: {
        id: this.id,
        title: this.title ?? "Untitled session",
        providerId,
        model,
        createdAt: this.createdAt,
        updatedAt: new Date().toISOString(),
        // plan + run ledger persist so a resumed session
        // tells the truth about what the previous run did.
        ...(this.plan !== null ? { plan: this.plan } : {}),
        ...(this.ledger.length > 0 ? { runLedger: capLedger(this.ledger) } : {}),
      },
      history: this.history.snapshot(),
    };
  }

  /** read-only view of this session's run ledger. */
  getRunLedger(): readonly RunLedgerEntry[] {
    return [...this.ledger];
  }

  /** Rewind: metadata view of in-memory checkpoints (contents never exposed). */
  getCheckpoints(): CheckpointMeta[] {
    return this.checkpoints.map(checkpointMeta);
  }

  /**
   * Hand over this session's checkpoints and empty the ring. Internal seam
   * for sub-agent delegation (the parent merges them into its own ring) —
   * not part of the UI surface.
   */
  drainCheckpoints(): Checkpoint[] {
    const drained = [...this.checkpoints];
    this.checkpoints = [];
    return drained;
  }

  /** Merge sub-agent checkpoints into this session's ring with fresh ids. */
  private async mergeSubCheckpoints(sub: readonly Checkpoint[]): Promise<void> {
    if (sub.length === 0) return;
    for (const cp of sub) {
      this.checkpointSeq += 1;
      this.checkpoints = capCheckpoints([
        ...this.checkpoints,
        { ...cp, id: this.checkpointSeq },
      ]);
    }
    await this.persistCheckpoints();
    this.recordLedger({ eventType: "checkpoint_merged", outcome: "ok", elapsedMs: 0 });
  }

  /**
   * Rewind: restore a checkpoint's files (originals written back, creations
   * deleted). The explicit call IS the consent — no permission prompt — and
   * the restore is ledger-recorded. Never creates a checkpoint itself.
   */
  async rewind(id: number): Promise<{
    ok: boolean;
    restored: string[];
    deleted: string[];
    errors: string[];
    message: string;
  }> {
    const cp = this.checkpoints.find((c) => c.id === id);
    if (!cp) {
      this.recordLedger({ eventType: "rewind", outcome: "error", elapsedMs: 0 });
      return {
        ok: false,
        restored: [],
        deleted: [],
        errors: [`No checkpoint #${id} in this session.`],
        message: `No checkpoint #${id} in this session.`,
      };
    }
    const startedAt = Date.now();
    const result = await restoreCheckpoint(this.options.projectRoot, cp);
    const ok = result.errors.length === 0;
    this.recordLedger({ eventType: "rewind", outcome: ok ? "ok" : "error", elapsedMs: Date.now() - startedAt });
    const parts: string[] = [];
    if (result.restored.length > 0) parts.push(`restored ${result.restored.length}: ${result.restored.join(", ")}`);
    if (result.deleted.length > 0) parts.push(`deleted ${result.deleted.length} created: ${result.deleted.join(", ")}`);
    if (result.errors.length > 0) parts.push(`errors: ${result.errors.join("; ")}`);
    return { ...result, ok, message: parts.length > 0 ? parts.join(" ") : "Checkpoint was empty — nothing to restore." };
  }

  private recordLedger(
    entry: Omit<RunLedgerEntry, "seq" | "ts">
  ): void {
    this.ledgerSeq += 1;
    this.ledger = capLedger([
      ...this.ledger,
      {
        ...entry,
        // Measured usage rides along ONLY on completion entries (record,
        // never predict) — control events (loop_detected, budget_exhausted,
        // cancelled, checkpoint_created, …) must not fabricate attribution.
        // Explicit tokens (e.g. a sub-agent's own usage) always win.
        ...(entry.tokens ??
          (entry.eventType === "tool_finished" && this.lastUsage
            ? { tokens: { in: this.lastUsage.inputTokens, out: this.lastUsage.outputTokens } }
            : {})),
        seq: this.ledgerSeq,
        ts: new Date().toISOString(),
      },
    ]);
  }

  /** Best-effort persist of the rewind ring. Awaited to avoid data loss on crash. */
  private async persistCheckpoints(): Promise<void> {
    await saveCheckpointsAsync(this.id, this.checkpoints);
  }

  /**
   * Cancellation between pushAssistant(tool_calls) and pushToolResults would
   * strand the assistant's tool calls with no tool_result reply — providers
   * reject that history on the next turn (Anthropic: "tool_use ids without
   * corresponding tool_result"; Gemini: missing functionResponse). Fill every
   * call that has no real outcome with a synthetic cancelled result, then
   * close the turn so the history stays replayable whatever the user does next.
   */
  private pushCancelledToolResults(
    prepared: readonly PreparedCall[],
    handled: ReadonlyMap<string, ToolExecutionResult>,
    runResults: ReadonlyMap<string, ToolExecutionResult> | undefined,
    turnNotes: readonly string[]
  ): void {
    const outcomes = new Map<string, ToolExecutionResult>([...(runResults ?? []), ...handled]);
    for (const p of prepared) {
      if (!outcomes.has(p.call.id)) {
        outcomes.set(p.call.id, {
          output: { error: "Cancelled by user before this tool could run." },
          isError: true,
          summary: "Cancelled.",
        });
      }
    }
    this.history.pushToolResults(prepared, outcomes, turnNotes);
  }

  async *send(
    userText: string,
    images: { mediaType: string; data: string }[] = []
  ): AsyncGenerator<AgentEvent> {
    if (this.isSending) {
      yield { type: "error", message: "A turn is already in progress for this session." };
      return;
    }
    this.isSending = true;
    this.history.pushUserText(userText, images);
    if (this.title === null) {
      const firstLine = userText.trim().split("\n")[0] ?? "";
      const chars = Array.from(firstLine);
      this.title = chars.length > 50 ? chars.slice(0, 49).join("") + "…" : firstLine;
    }
    // A fresh controller per send() call — cancelling one turn must not poison the next.
    const controller = new AbortController();
    this.currentController = controller;

    // per-turn loop state starts clean on every send().
    // A fresh TurnState per call — budget and loop-guard state must never
    // leak across turns (a reused instance would instantly budget_exhaust).
    const turn = new TurnState(this.maxInnerIterations);

    try {
      while (true) {
        if (controller.signal.aborted) {
          yield { type: "cancelled" };
          return;
        }

        // iteration budget — never run unbounded, never truncate
        // silently. The notice is an assistant-role message because the history
        // model has no "system" role and role alternation must stay valid for every
        // provider .
        if (turn.checkBudget()) {
          this.recordLedger({ eventType: "budget_exhausted", outcome: "aborted", elapsedMs: 0 });
          yield { type: "budget_exhausted" };
          this.history.pushBudgetNotice(this.maxInnerIterations);
          return;
        }

        // Reactive compaction: if the previous turn's input tokens crossed the
        // model's context-window threshold, summarize older history first.
        // Best-effort: a summarizer failure must never kill the turn, and a
        // second attempt later in the same turn would thrash history — so the
        // turn gets exactly one summarization ATTEMPT. The cheap guards are
        // peeked first: a below-threshold loop-top must not burn the attempt
        // (lastInputTokens is stale until the first round of THIS turn lands).
        const modelInfo = getModel(this.options.model);
        if (
          modelInfo &&
          !turn.compactedThisTurn &&
          this.lastInputTokens >= modelInfo.contextWindow * COMPACTION_THRESHOLD &&
          this.history.length > KEEP_RECENT_MESSAGES
        ) {
          turn.markCompactionAttempted();
          try {
            const { history: compacted, result } = await compactIfNeeded(
              this.history.snapshot(),
              modelInfo.contextWindow,
              this.lastInputTokens,
              this.provider,
              this.options.model,
              controller.signal
            );
            if (result.compacted) {
              // Preserve role alternation on merge (several providers reject
              // consecutive users); HistoryStore owns the merge.
              this.history.applyCompacted(compacted);
              yield { type: "compacted", summary: result.summary! };
            }
          } catch {
            // Summarization failed (or was aborted) — proceed uncompacted.
            // An abort surfaces as `cancelled` at the next loop-top check.
          }
        }

        if (isCircuitOpen(this.provider.id, this.options.model)) {
          yield { type: "error", message: `Provider circuit breaker is open. Wait before retrying.` };
          return;
        }

        const stream = this.provider.streamCompletion({
          model: this.options.model,
          systemPrompt: this.options.systemPrompt,
          messages: this.history.snapshot(), // snapshot — never expose the live array to the provider
          tools: this.toolDefs,
          maxTokens: this.options.maxTokens,
          signal: controller.signal,
        });

        // Accumulate this turn's assistant content so it can be pushed to history once
        // complete, and collect any tool calls to execute after the stream ends.
        const textParts: string[] = [];
        const toolCalls: AccumulatedToolCall[] = [];
        const openCalls = new Map<string, { name: string; inputJson: string }>();
        let stopReason: string | undefined;
        let rateLimitRetry: number | null = null;

        for await (const event of stream) {
          switch (event.type) {
            case "text_delta":
              textParts.push(event.text);
              yield { type: "text_delta", text: event.text };
              break;
            case "tool_call_start":
              openCalls.set(event.id, { name: event.name, inputJson: "" });
              break;
            case "tool_call_delta": {
              const open = openCalls.get(event.id);
              // Cumulative buffer (see providers/streaming.ts): overwrite.
              if (open) open.inputJson = event.cumulativeInputJson;
              break;
            }
            case "tool_call_end": {
              const open = openCalls.get(event.id);
              let input: unknown;
              if (event.input !== undefined && event.input !== null) {
                input = event.input;
              } else {
                const raw = open?.inputJson ?? "";
                if (raw.trim()) {
                  try {
                    input = JSON.parse(raw);
                  } catch {
                    input = {}; // tool executor reports validation errors back to the model
                  }
                } else {
                  input = {};
                }
              }
              openCalls.delete(event.id);
              toolCalls.push({
                id: event.id,
                name: event.name ?? open?.name ?? "",
                input,
                // Provider-specific data (e.g. Gemini thought signatures) that
                // must survive into the history we replay next turn.
                ...(event.providerMetadata ? { providerMetadata: event.providerMetadata } : {}),
              });
              break;
            }
            case "usage":
              this.lastInputTokens = event.inputTokens;
              this.lastUsage = { inputTokens: event.inputTokens, outputTokens: event.outputTokens };
              yield { type: "usage", inputTokens: event.inputTokens, outputTokens: event.outputTokens };
              break;
            case "error": {
              // Rate limits get ONE automatic retry per turn: wait out the
              // window, then re-issue the request. Nothing has been pushed
              // to history on this path, so the retry replays cleanly. A
              // second 429 in the same turn surfaces as a normal error.
              if (isRateLimitMessage(event.message)) {
                noteRateLimited(this.provider.id, this.options.model);
                // Exactly one circuit failure per failed request — noteRateLimited
                // never touches the breaker, this is its single accounting point.
                // Other errors (bad-model 404s, network) must NOT open the circuit.
                recordFailure(this.provider.id, this.options.model);
                if (!turn.rateLimitRetried) {
                  turn.rateLimitRetried = true;
                  const consecutive = getConsecutiveRateLimitCount(this.provider.id, this.options.model);
                  rateLimitRetry = rateLimitRetrySeconds(event.message, consecutive);
                  break; // leave the switch; the loop breaks out below
                }
              }
              yield { type: "error", message: event.message };
              return;
            }
            case "turn_end":
              stopReason = event.stopReason;
              break;
          }
        }

        if (rateLimitRetry !== null) {
          yield { type: "rate_limit_wait", seconds: rateLimitRetry };
          try {
            await sleepAbortable(rateLimitRetry * 1000, controller.signal);
          } catch {
            yield { type: "cancelled" };
            return;
          }
          continue;
        }

        if (controller.signal.aborted) {
          yield { type: "cancelled" };
          return;
        }

        // Record the assistant turn (text and/or tool_use blocks) in history
        // before anything else — including for plain text turns, which must
        // still be part of the conversation the provider sees next turn.
        this.history.pushAssistant(textParts, toolCalls);

        if (stopReason !== "tool_use") {
          // Closed-loop TDD auto-verification: if mutations occurred and autoVerify is active,
          // probe tests before concluding turn.
          const testCmd =
            typeof this.options.autoVerify === "string"
              ? this.options.autoVerify
              : this.options.autoVerify
                ? detectTestCommand(this.options.projectRoot)
                : null;

          if (testCmd && turn.mutationsOccurred && turn.verifyRepairsUsed < MAX_VERIFY_REPAIRS) {
            yield { type: "verification_started", command: testCmd };
            this.recordLedger({ eventType: "verification_started", tool: testCmd, outcome: "ok", elapsedMs: 0 });
            const verifyStart = Date.now();
            const verifyResult = await runTestVerification(
              this.options.projectRoot,
              testCmd,
              undefined,
              controller.signal
            );
            const elapsed = Date.now() - verifyStart;

            if (controller.signal.aborted) {
              yield { type: "cancelled" };
              return;
            }

            if (verifyResult.passed) {
              yield { type: "verification_result", passed: true, summary: verifyResult.summary };
              this.recordLedger({ eventType: "verification_finished", tool: testCmd, outcome: "ok", elapsedMs: elapsed });
            } else {
              turn.verifyRepairsUsed += 1;
              yield { type: "verification_result", passed: false, summary: verifyResult.summary };
              this.recordLedger({ eventType: "verification_finished", tool: testCmd, outcome: "error", elapsedMs: elapsed });

              const repairMsg =
                `[Automated Test Verification Failed]\n` +
                `The test command \`${testCmd}\` failed (exit ${verifyResult.exitCode}):\n` +
                `${verifyResult.failureTrace ?? verifyResult.output}\n\n` +
                `Analyze the test failure, use edit_file or write_file to repair the issue, and ensure the tests pass.`;
              this.history.pushUserText(repairMsg);
              continue;
            }
          }

          recordSuccess(this.provider.id, this.options.model);
          yield { type: "turn_complete" };
          return;
        }

        // bounded, loop-safe, ordered tool orchestration.
        turn.markIteration();

        const turnNotes: string[] = [];
        // Classify in DECLARED order first: the consecutive same-key streak
        // and the declared-order contract are order-sensitive.
        const prepared: PreparedCall[] = LoopGuard.classify(toolCalls, this.toolDefs, turn);

        // update_plan is handled by the session (sets this.plan + emits
        // plan_updated) and never runs the generic executor; refused loop calls
        // never run at all.
        const handled = new Map<string, ToolExecutionResult>();
        const toRun: RunnableCall[] = [];
        for (const p of prepared) {
          if (p.loopWarn) {
            this.recordLedger({ eventType: "loop_detected", tool: p.call.name, inputHash: p.key, outcome: "error", elapsedMs: 0 });
            yield { type: "loop_detected", tool: p.call.name };
            turnNotes.push(LoopGuard.warnText(p.call.name, "consecutive"));
          }
          if (p.repeatWarn) {
            this.recordLedger({ eventType: "loop_detected", tool: p.call.name, inputHash: p.key, outcome: "error", elapsedMs: 0 });
            yield { type: "loop_detected", tool: p.call.name };
            turnNotes.push(LoopGuard.warnText(p.call.name, "non-consecutive"));
          }
          if (p.call.name === "update_plan") {
            const plan = (p.call.input as { plan?: unknown } | undefined)?.plan;
            if (typeof plan === "string" && plan.trim()) {
              this.plan = plan;
              this.recordLedger({ eventType: "plan_updated", tool: "update_plan", inputHash: p.key, outcome: "ok", elapsedMs: 0 });
              yield { type: "plan_updated", plan };
              handled.set(p.call.id, { output: { ok: true }, isError: false, summary: "Plan updated." });
            } else {
              this.recordLedger({ eventType: "tool_finished", tool: "update_plan", inputHash: p.key, outcome: "error", elapsedMs: 0 });
              handled.set(p.call.id, {
                output: { error: "update_plan requires a string `plan`." },
                isError: true,
                summary: "update_plan: plan must be a string.",
              });
            }
            continue;
          }
          if (p.call.name === "delegate_task") {
            // sub-agent delegation — intercepted like update_plan and
            // executed inline (serially, in declared order), never in a batch.
            const task = (p.call.input as { task?: unknown } | undefined)?.task;
            if (!this.options.allowDelegation) {
              this.recordLedger({ eventType: "tool_finished", tool: "delegate_task", inputHash: p.key, outcome: "error", elapsedMs: 0 });
              handled.set(p.call.id, {
                output: { error: "delegate_task is not available to sub-agents (depth limit)." },
                isError: true,
                summary: "Delegation not allowed at this depth.",
              });
              continue;
            }
            if (typeof task !== "string" || !task.trim()) {
              this.recordLedger({ eventType: "tool_finished", tool: "delegate_task", inputHash: p.key, outcome: "error", elapsedMs: 0 });
              handled.set(p.call.id, {
                output: { error: "delegate_task requires a string `task`." },
                isError: true,
                summary: "delegate_task: task must be a string.",
              });
              continue;
            }
            if (!turn.tryConsumeDelegation(MAX_DELEGATIONS_PER_TURN)) {
              this.recordLedger({ eventType: "tool_finished", tool: "delegate_task", inputHash: p.key, outcome: "error", elapsedMs: 0 });
              handled.set(p.call.id, {
                output: { error: `Delegation limit reached (${MAX_DELEGATIONS_PER_TURN} per turn).` },
                isError: true,
                summary: "Delegation limit reached.",
              });
              continue;
            }
            this.recordLedger({ eventType: "subagent_started", tool: "delegate_task", inputHash: p.key, outcome: "ok", elapsedMs: 0 });
            yield { type: "subagent_started", task };
            const subStartedAt = Date.now();
            // Live delegation: relay the sub-agent's tool activity as
            // subagent_progress events while the run is in flight, then take
            // the final run (generator return value).
            const subGen = runSubAgentLive({
              provider: this.provider,
              model: this.options.model,
              projectRoot: this.options.projectRoot,
              permissionBroker: this.options.permissionBroker,
              task,
              signal: controller.signal,
              // sub-agents inherit the main session's tools (incl.
              // MCP) minus delegate_task, under the same shared broker.
              tools: this.toolDefs,
            });
            let subStep = await subGen.next();
            while (!subStep.done) {
              yield subStep.value;
              subStep = await subGen.next();
            }
            const run = subStep.value;
            if (run.aborted) {
              // Merge even on abort: files changed before the stop persist.
              await this.mergeSubCheckpoints(run.checkpoints);
              this.recordLedger({ eventType: "cancelled", tool: "delegate_task", inputHash: p.key, outcome: "aborted", elapsedMs: Date.now() - subStartedAt });
              // Close the tool batch honestly before stopping — sibling calls
              // and the delegation itself need tool_results in history.
              this.pushCancelledToolResults(prepared, handled, undefined, turnNotes);
              yield { type: "cancelled" };
              return;
            }
            // The sub-ring joins the parent ring (fresh ids, capped): rewind
            // in the main session reaches sub-agent file writes too.
            await this.mergeSubCheckpoints(run.checkpoints);
            this.recordLedger({
              eventType: "subagent_finished",
              tool: "delegate_task",
              inputHash: p.key,
              outcome: "ok",
              tokens: run.usage,
              elapsedMs: Date.now() - subStartedAt,
            });
            yield {
              type: "subagent_finished",
              toolCalls: run.toolCalls,
              inputTokens: run.usage.in,
              outputTokens: run.usage.out,
              report: run.report,
            };
            handled.set(p.call.id, {
              output: { report: run.report },
              isError: false,
              summary: `Sub-agent report (${run.toolCalls} tool call${run.toolCalls === 1 ? "" : "s"}).`,
            });
            continue;
          }
          if (p.refused) {
            this.recordLedger({ eventType: "loop_refused", tool: p.call.name, inputHash: p.key, outcome: "error", elapsedMs: 0 });
            handled.set(p.call.id, LoopGuard.refusedResult());
            continue;
          }
          toRun.push({ p, startedAt: Date.now() });
        }
        // Rewind: snapshot write_file/edit_file targets BEFORE any permission
        // prompt or execution. Matched by NAME, pre-permission — a denied tool
        // changes nothing, so restoring over it stays correct. Batches with no
        // file writes (reads, run_command-only) snapshot nothing.
        const rewindTargets = [...new Set(prepared.flatMap((p) => {
          if (p.call.name !== "write_file" && p.call.name !== "edit_file") return [];
          const target = (p.call.input as { path?: unknown } | undefined)?.path;
          return typeof target === "string" && target.length > 0 ? [target] : [];
        }))];
        if (rewindTargets.length > 0) {
          const cp = await takeSnapshot(this.options.projectRoot, this.checkpointSeq + 1, rewindTargets);
          if (cp.files.length > 0) {
            this.checkpointSeq = cp.id;
            this.checkpoints = capCheckpoints([...this.checkpoints, cp]);
            await this.persistCheckpoints();
            this.recordLedger({ eventType: "checkpoint_created", outcome: "ok", elapsedMs: 0 });
            yield { type: "checkpoint", id: cp.id, files: cp.files.length };
          }
        }
        // Declared parallel policy + execution live in the orchestrator;
        // results merge here with intercepted outcomes (handled wins) and
        // rebuild into history in EXACTLY declared call order .
        const orchestrator = new ToolOrchestrator({
          projectRoot: this.options.projectRoot,
          permissionBroker: this.options.permissionBroker,
          signal: controller.signal,
          recordLedger: (entry) => this.recordLedger(entry),
        });
        const runResults = yield* orchestrator.run(toRun);
        // Abandoned batch (orchestrator returned early on abort): repair the
        // history first so the NEXT turn replays valid tool_call/tool_result
        // pairs, then surface the cancellation. Whatever the orchestrator did
        // complete is preserved as the real result.
        if (!runResults || controller.signal.aborted) {
          this.pushCancelledToolResults(prepared, handled, runResults, turnNotes);
          yield { type: "cancelled" };
          return;
        }
        const outcomes = new Map<string, ToolExecutionResult>([...runResults, ...handled]);
        for (const p of prepared) {
          // A mutation happened only if the tool actually ran and succeeded —
          // a missing outcome (cancelled batch) or an error is not a mutation.
          const outcome = outcomes.get(p.call.id);
          if (p.def?.mutating && outcome && !outcome.isError) {
            turn.mutationsOccurred = true;
          }
        }

        // Loop-guard demands lead the results message as a user-role text part
        // (the data model has no "system" role).
        this.history.pushToolResults(prepared, outcomes, turnNotes);
      }
    } catch (err: any) {
      if (controller.signal.aborted) {
        yield { type: "cancelled" };
        return;
      }
      if (isRateLimitMessage(err?.message ?? String(err))) {
        noteRateLimited(this.provider.id, this.options.model);
        recordFailure(this.provider.id, this.options.model);
      } else {
        clearRateLimitRecord(this.provider.id, this.options.model);
      }
      yield { type: "error", message: err?.message ?? String(err) };
    } finally {
      if (this.currentController === controller) this.currentController = null;
      this.isSending = false;
    }
  }
}
