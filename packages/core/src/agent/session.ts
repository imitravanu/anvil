import { getErrorMessage, sleepAbortable } from "../errors.js";
import { randomUUID } from "node:crypto";
import { type ModelProvider, type ConversationMessage } from "../providers/types.js";
import { getModel } from "../providers/registry.js";
import { TOOL_DEFINITIONS, getSessionToolHandler } from "../tools/index.js";
import type { ToolExecutionResult, ToolDefinition } from "../tools/types.js";
import { finishTurn } from "./turnVerifier.js";
import { COMPACTION_THRESHOLD, KEEP_RECENT_MESSAGES, compactIfNeeded, estimateTokens } from "./compaction.js";
import { FALLBACK_CONTEXT_WINDOW, MAX_VERIFY_REPAIRS } from "../config/constants.js";
export { MAX_VERIFY_REPAIRS };
import { SessionMetadata, StoredSession } from "../session/types.js";
import { AgentEvent, AgentOptions, DEFAULT_MAX_INNER_ITERATIONS } from "./types.js";
import { RunLedgerEntry } from "./ledger.js";
import { SessionLedger } from "./sessionLedger.js";
import { clearRateLimitRecord, isCircuitOpen, isRateLimitMessage, noteRateLimited, recordFailure, recordSuccess } from "../providers/freeModels.js";
import { MAX_DELEGATIONS_PER_TURN, runSubAgentLive } from "./subagent.js";
import { loadCustomGuardianRules, type CustomGuardianRule } from "../guardian/rules.js";
import { detectGuardianScope, type GuardianScope } from "../guardian/scope.js";
import { TurnState } from "./turnState.js";
import { streamAssistantTurn, type TurnStreamResult } from "./turnStream.js";
import { LoopGuard, type PreparedCall } from "./loopGuard.js";
import type { TeamRunResult } from "./team/types.js";
import { ToolOrchestrator, type RunnableCall } from "./orchestrator.js";
import { HistoryStore } from "./historyStore.js";
import {
  type Checkpoint,
  type CheckpointMeta,
  type SessionFileChange,
} from "./checkpoints.js";
import { RewindRing } from "./rewindRing.js";
import { guardianInterceptCalls } from "./guardianIntercept.js";

export interface RestoreData {
  metadata: SessionMetadata;
  history: ConversationMessage[];
}

export class AgentSession {
  private history = new HistoryStore();
  private currentController: AbortController | null = null;
  private pendingCancel = false;
  private isSending = false;
  private provider: ModelProvider;
  private options: AgentOptions;
  // The previous turn's input token count — compaction uses it reactively.
  private lastInputTokens = 0;
  // durable-loop state.
  readonly maxInnerIterations: number;
  /** Current plan, set by the update_plan tool; persists on save. */
  plan: string | null = null;
  private ledger = new SessionLedger();
  private lastUsage: { inputTokens: number; outputTokens: number } | null = null;
  // resolved tool list (sub-agents exclude delegate_task; MCP seam).
  // Per-turn counters (iterations, delegations, loop streaks) live in
  // TurnState, fresh per send() — never as session fields.
  private toolDefs: ToolDefinition[];
  // Rewind state: persisted, ring-bounded pre-mutation snapshots + the
  // ring-independent review baseline (see rewindRing.ts).
  private readonly rewindRing: RewindRing;
  // Project-declared guardian rules, loaded ONCE per session (no per-turn I/O).
  private readonly guardianRules: CustomGuardianRule[];
  /** Whether Anvil's own rule families apply to this project (see guardian/scope.ts). */
  private readonly guardianScope: GuardianScope;
  /** Master switch for the guardian interceptor (26.3). Default true. */
  private readonly guardianEnabled: boolean;
  /** Last completed delegate_task team run (Phase 25.2 introspection for /team status). */
  private lastTeamRun: TeamRunResult | null = null;
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
    this.guardianRules = loadCustomGuardianRules(this.options.projectRoot);
    this.guardianScope = detectGuardianScope(this.options.projectRoot);
    // Guardian opt-out (26.3): default ON. Sub-agents inherit the parent's
    // choice via the toolSessionContext so the matrix toggles the whole
    // stack, not just the top-level turn loop.
    this.guardianEnabled = options.guardian ?? true;
    this.id = restore?.metadata.id ?? randomUUID();
    this.rewindRing = new RewindRing({
      projectRoot: this.options.projectRoot,
      sessionId: this.id,
      recordLedger: (e) => this.recordLedger(e),
    });
    this.title = restore?.metadata.title ?? null;
    this.createdAt = restore?.metadata.createdAt ?? new Date().toISOString();
    if (restore) {
      this.history = new HistoryStore(restore.history);
      this.plan = restore.metadata.plan ?? null;
      this.ledger = new SessionLedger(restore.metadata.runLedger ?? []);
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

  /** The active model's context window (bytes budget for /context display). */
  get contextWindow(): number {
    const modelInfo = getModel(this.options.model, this.provider.id);
    return modelInfo?.contextWindow ?? FALLBACK_CONTEXT_WINDOW;
  }

  /**
   * /diff review: file changes this session made, diffed against the
   * pre-change snapshots. Contents never leave the session — the caller
   * gets finished diffs, not snapshot bytes. Uses the ring-independent
   * baseline so capped checkpoint eviction never hides changes.
   */
  summarizeChanges(): Promise<SessionFileChange[]> {
    return this.rewindRing.summarizeChanges();
  }

  /**
   * Coverage honesty for /diff and /rewind: how many paths aged out of the
   * bounded review baseline, and how many checkpoints the ring cap evicted.
   * Zero on a normal session; non-zero means the review (or undo depth) is no
   * longer complete, and the UI must say so instead of presenting a partial
   * result as whole.
   */
  diffCoverage(): { baselineDropped: number; ringDropped: number } {
    return {
      baselineDropped: this.rewindRing.baselineDroppedPaths,
      ringDropped: this.rewindRing.ringDroppedCheckpoints,
    };
  }

  /** Read-only view of the conversation history (exposed for tests / future phases). */
  getHistory(): readonly ConversationMessage[] {
    return this.history.get();
  }

  cancel(): void {
    if (this.currentController) {
      this.currentController.abort();
    } else {
      this.pendingCancel = true;
    }
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
    if (this.isSending) {
      throw new Error("Cannot change model while a turn is in progress.");
    }
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
    if (this.isSending) {
      throw new Error("Cannot unwind history while a turn is in progress.");
    }
    return this.history.popLastUserTurn();
  }

  /** Wipe conversation history (the `/clear` command). */
  clearHistory(): void {
    if (this.isSending) {
      throw new Error("Cannot clear history while a turn is in progress.");
    }
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
        ...(this.ledger.size > 0 ? { runLedger: this.ledger.toPersist() } : {}),
      },
      history: this.history.snapshot(),
    };
  }

  /** read-only view of this session's run ledger. */
  getRunLedger(): readonly RunLedgerEntry[] {
    return this.ledger.snapshot();
  }

  /** Rewind: metadata view of in-memory checkpoints (contents never exposed). */
  getCheckpoints(): CheckpointMeta[] {
    return this.rewindRing.listMeta();
  }

  /**
   * Hand over this session's checkpoints and empty the ring. Internal seam
   * for sub-agent delegation (the parent merges them into its own ring) —
   * not part of the UI surface.
   */
  drainCheckpoints(): Checkpoint[] {
    return this.rewindRing.drain();
  }

  /** Merge sub-agent checkpoints into this session's ring with fresh ids. */
  private async mergeSubCheckpoints(sub: readonly Checkpoint[]): Promise<void> {
    await this.rewindRing.merge(sub);
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
    /** Targets edited on disk outside this session — restored anyway, reported. */
    externallyModified: string[];
    message: string;
  }> {
    return this.rewindRing.rewind(id);
  }

  private recordLedger(
    entry: Omit<RunLedgerEntry, "seq" | "ts">
  ): void {
    this.ledger.record(entry, this.lastUsage);
  }

  /** Last completed team run, or null before any team delegation this session. */
  get teamRun(): TeamRunResult | null {
    return this.lastTeamRun;
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
    if (this.pendingCancel) {
      this.pendingCancel = false;
      controller.abort();
    }

    // A fresh TurnState per call — budget and loop-guard state must never
    // leak across turns (a reused instance would instantly budget_exhaust).
    const turn = new TurnState(this.maxInnerIterations);
    turn.task = userText;

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

        // Reactive compaction: at most one attempt per turn (see maybeCompact).
        yield* this.maybeCompact(controller, turn);

        if (isCircuitOpen(this.provider.id, this.options.model)) {
          yield { type: "error", message: `Provider circuit breaker is open. Wait before retrying.` };
          return;
        }

        const streamRes = yield* this.streamAssistantTurn(controller, turn);
        if (!streamRes) {
          return;
        }

        const { textParts, toolCalls, stopReason, rateLimitRetry, sawUsage } = streamRes;

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

        this.history.pushAssistant(textParts, toolCalls);

        if (!sawUsage) {
          this.lastInputTokens = estimateTokens(this.history.snapshot());
        }

        if (stopReason !== "tool_use") {
          // Terminal sequence (verify → close or request a repair) lives in
          // turnVerifier.finishTurn so the event ordering is in one place.
          const completion = yield* finishTurn({
            projectRoot: this.options.projectRoot,
            autoVerify: this.options.autoVerify,
            mutationsOccurred: turn.mutationsOccurred,
            verifyRepairsUsed: turn.verifyRepairsUsed,
            maxVerifyRepairs: MAX_VERIFY_REPAIRS,
            stopReason,
            signal: controller.signal,
            recordLedger: (e) => this.recordLedger(e),
            pushRepairPrompt: (msg) => this.history.pushUserText(msg),
            onSuccess: () => recordSuccess(this.provider.id, this.options.model),
          });
          if (completion.action === "continue") {
            turn.verifyRepairsUsed += 1;
            continue;
          }
          return;
        }

        turn.markIteration();

        const turnNotes: string[] = [];
        const prepared: PreparedCall[] = LoopGuard.classify(toolCalls, this.toolDefs, turn);
        const handled = new Map<string, ToolExecutionResult>();

        // Phase 25.6 → product: native guardian gate. Refuses (or auto-fixes)
        // pending file mutations BEFORE they reach the orchestrator. The
        // decision and refusal results come from guardianInterceptCalls; the
        // repair prompt is pushed here because the session owns history.
        const guardian = guardianInterceptCalls(prepared, {
          enabled: this.guardianEnabled,
          scope: this.guardianScope,
          rules: this.guardianRules,
          recordLedger: (entry) => this.recordLedger(entry),
        });
        if (guardian.repairPrompt) this.history.pushUserText(guardian.repairPrompt);
        const guardianBlocked = guardian.blocked;
        for (const [id, result] of guardian.handled) handled.set(id, result);
        if (guardian.event) yield guardian.event;

        const toRun: RunnableCall[] = [];
        const cancelled = yield* this.dispatchToolCalls(
          prepared,
          turn,
          controller,
          turnNotes,
          handled,
          guardianBlocked,
          toRun
        );
        if (cancelled) {
          this.pushCancelledToolResults(prepared, handled, undefined, turnNotes);
          return;
        }

        const batchCancelled = yield* this.settleToolBatch(
          prepared,
          toRun,
          handled,
          turn,
          controller,
          turnNotes
        );
        if (batchCancelled) return;
      }
    } catch (err: unknown) {
      this.history.repairUnclosedToolCalls(getErrorMessage(err));
      if (controller.signal.aborted) {
        yield { type: "cancelled" };
        return;
      }
      if (isRateLimitMessage(getErrorMessage(err))) {
        noteRateLimited(this.provider.id, this.options.model);
        recordFailure(this.provider.id, this.options.model);
      } else {
        clearRateLimitRecord(this.provider.id, this.options.model);
      }
      yield { type: "error", message: getErrorMessage(err) };
    } finally {
      if (this.currentController === controller) this.currentController = null;
      this.isSending = false;
    }
  }

  /**
   * Reactive compaction. Runs at most once per turn: a summarizer failure must
   * never kill the turn, and a second attempt in the same turn would thrash
   * history. The cheap guards are peeked inside so a below-threshold loop-top
   * never burns the attempt (lastInputTokens is stale until this turn's first
   * round lands).
   */
  private async *maybeCompact(
    controller: AbortController,
    turn: TurnState
  ): AsyncGenerator<AgentEvent> {
    const modelInfo = getModel(this.options.model, this.provider.id);
    // Free-form model ids are supported on purpose, so an unknown id must still
    // compact — a conservative default window beats dying on the real limit.
    const contextWindow = modelInfo?.contextWindow ?? FALLBACK_CONTEXT_WINDOW;
    if (
      turn.compactedThisTurn ||
      this.lastInputTokens < contextWindow * COMPACTION_THRESHOLD ||
      this.history.length <= KEEP_RECENT_MESSAGES
    ) {
      return;
    }
    turn.markCompactionAttempted();
    try {
      const { history: compacted, result } = await compactIfNeeded(
        this.history.snapshot(),
        contextWindow,
        this.lastInputTokens,
        this.provider,
        this.options.model,
        controller.signal,
        { summarizerModel: this.options.compactionModel, task: turn.task }
      );
      if (result.compacted) {
        // Preserve role alternation on merge (several providers reject
        // consecutive users); HistoryStore owns the merge.
        this.history.applyCompacted(compacted);
        yield { type: "compacted", summary: result.summary! };
      }
    } catch (err) {
      console.warn(`[session] Warning: compaction failed: ${getErrorMessage(err)}`);
      // Summarization failed (or was aborted) — proceed uncompacted. An abort
      // surfaces as `cancelled` at the next loop-top check.
    }
  }

  /**
   * Loop-guard annotations + session-tool dispatch, in DECLARED call order.
   * Loop-refused calls never reach their session-tool executor. Returns true
   * when a session tool reported cancellation, so the caller can close out.
   */
  private async *dispatchToolCalls(
    prepared: readonly PreparedCall[],
    turn: TurnState,
    controller: AbortController,
    turnNotes: string[],
    handled: Map<string, ToolExecutionResult>,
    guardianBlocked: ReadonlySet<string>,
    toRun: RunnableCall[]
  ): AsyncGenerator<AgentEvent, boolean> {
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
      if (p.refused) {
        // Refusal is decided BEFORE session-tool handling: a loop-refused
        // delegate_task/update_plan must never reach its executor.
        this.recordLedger({ eventType: "loop_refused", tool: p.call.name, inputHash: p.key, outcome: "error", elapsedMs: 0 });
        handled.set(p.call.id, LoopGuard.refusedResult());
        continue;
      }
      if (guardianBlocked.has(p.call.id)) {
        continue; // result already in `handled` (guardian refusal)
      }
      const sessionTool = getSessionToolHandler(p.call.name);
      if (sessionTool) {
        const toolGen = sessionTool(
          p.call.input,
          {
            setPlan: (newPlan: string) => {
              this.plan = newPlan;
            },
            recordLedger: (entry) => {
              this.recordLedger(entry);
            },
            allowDelegation: this.options.allowDelegation !== false,
            tryConsumeDelegation: (max: number) => turn.tryConsumeDelegation(max),
            provider: this.provider,
            model: this.options.model,
            projectRoot: this.options.projectRoot,
            permissionBroker: this.options.permissionBroker,
            tools: this.toolDefs,
            signal: controller.signal,
            mergeSubCheckpoints: async (cps) => {
              await this.mergeSubCheckpoints(cps);
            },
            recordMutation: () => {
              turn.mutationsOccurred = true;
            },
            onTeamRunResult: (result) => {
              this.lastTeamRun = result;
            },
            guardian: this.guardianEnabled,
          },
          p.key
        );
        let item = await toolGen.next();
        let cancelled = false;
        while (!item.done) {
          yield item.value;
          if (item.value.type === "cancelled") {
            cancelled = true;
          }
          item = await toolGen.next();
        }
        if (cancelled) return true;
        handled.set(p.call.id, item.value);
        continue;
      }
      toRun.push({ p, startedAt: Date.now() });
    }
    return false;
  }

  /**
   * Streams one assistant round. The accumulation/rate-limit contract lives in
   * turnStream.ts; the session only supplies its live provider + history.
   */
  private streamAssistantTurn(
    controller: AbortController,
    turn: TurnState
  ): AsyncGenerator<AgentEvent, TurnStreamResult | null> {
    return streamAssistantTurn({
      provider: this.provider,
      model: this.options.model,
      systemPrompt: this.options.systemPrompt,
      messages: this.history.snapshot(),
      tools: this.toolDefs,
      maxTokens: this.options.maxTokens,
      controller,
      turn,
      onUsage: (usage) => {
        this.lastInputTokens = usage.inputTokens;
        this.lastUsage = usage;
      },
    });
  }

  /**
   * Snapshot → execute → settle one tool batch. Returns true when the batch was
   * cancelled (the `cancelled` event is yielded first). Extracted from `send()`
   * so the loop body reads as schedule → dispatch → settle → verify → close,
   * and the checkpoint/history bookkeeping lives in one place.
   */
  private async *settleToolBatch(
    prepared: readonly PreparedCall[],
    toRun: readonly RunnableCall[],
    handled: Map<string, ToolExecutionResult>,
    turn: TurnState,
    controller: AbortController,
    turnNotes: string[]
  ): AsyncGenerator<AgentEvent, boolean> {
    const pendingCp = await this.takeRewindSnapshot(prepared);

    const orchestrator = new ToolOrchestrator({
      projectRoot: this.options.projectRoot,
      permissionBroker: this.options.permissionBroker,
      signal: controller.signal,
      recordLedger: (entry) => this.recordLedger(entry),
    });
    const runResults = yield* orchestrator.run(toRun);
    if (controller.signal.aborted) {
      // S1.3: mutations that completed before the abort still exist on
      // disk — commit their undo entries before reporting cancellation.
      // Dropping the pending snapshot here used to make completed writes
      // unrecoverable via /rewind.
      if (pendingCp) {
        const partialOutcomes = new Map<string, ToolExecutionResult>([...runResults, ...handled]);
        const cpEvent = await this.commitRewindSnapshot(pendingCp, prepared, partialOutcomes);
        if (cpEvent) yield cpEvent;
      }
      this.pushCancelledToolResults(prepared, handled, runResults, turnNotes);
      yield { type: "cancelled" };
      return true;
    }
    const outcomes = new Map<string, ToolExecutionResult>([...runResults, ...handled]);
    for (const p of prepared) {
      const outcome = outcomes.get(p.call.id);
      if (p.def?.mutating && outcome && !outcome.isError) {
        turn.mutationsOccurred = true;
      }
    }
    if (pendingCp) {
      const cpEvent = await this.commitRewindSnapshot(pendingCp, prepared, outcomes);
      if (cpEvent) yield cpEvent;
    }

    this.history.pushToolResults(prepared, outcomes, turnNotes);
    return false;
  }

  private async takeRewindSnapshot(prepared: readonly PreparedCall[]): Promise<Checkpoint | null> {
    const rewindTargets = [...new Set(prepared.flatMap((p) => {
      if (p.call.name !== "write_file" && p.call.name !== "edit_file") return [];
      const target = (p.call.input as { path?: unknown } | undefined)?.path;
      return typeof target === "string" && target.length > 0 ? [target] : [];
    }))];
    if (rewindTargets.length === 0) return null;
    return this.rewindRing.take(rewindTargets);
  }

  private async commitRewindSnapshot(
    pendingCp: Checkpoint,
    prepared: readonly PreparedCall[],
    outcomes: ReadonlyMap<string, ToolExecutionResult>
  ): Promise<AgentEvent | null> {
    // S1.3: keep only the snapshots for write/edit targets whose calls
    // actually succeeded — a denied, refused, or failed call did not change
    // its file, so its pre-state must not claim undo coverage.
    const succeededPaths = new Set<string>();
    for (const p of prepared) {
      if (p.call.name !== "write_file" && p.call.name !== "edit_file") continue;
      const outcome = outcomes.get(p.call.id);
      if (!outcome || outcome.isError) continue;
      const target = (p.call.input as { path?: unknown } | undefined)?.path;
      if (typeof target === "string") succeededPaths.add(target);
    }
    if (succeededPaths.size === 0) return null;
    const committed = await this.rewindRing.commit(pendingCp, succeededPaths);
    if (!committed) return null;
    return { type: "checkpoint", id: committed.id, files: committed.files.length };
  }
}
