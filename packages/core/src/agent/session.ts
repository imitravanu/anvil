import { getErrorMessage, sleepAbortable } from "../errors.js";
import { randomUUID } from "node:crypto";
import { type ModelProvider, type ConversationMessage } from "../providers/types.js";
import { getModel } from "../providers/registry.js";
import { TOOL_DEFINITIONS, describeToolInput, getSessionToolHandler } from "../tools/index.js";
import type { ToolExecutionResult, ToolDefinition } from "../tools/types.js";
import { verifyTurnMutations } from "./turnVerifier.js";
import { COMPACTION_THRESHOLD, KEEP_RECENT_MESSAGES, compactIfNeeded, estimateTokens } from "./compaction.js";
import { FALLBACK_CONTEXT_WINDOW, MAX_VERIFY_REPAIRS } from "../config/constants.js";
export { MAX_VERIFY_REPAIRS };
import { SessionMetadata, StoredSession } from "../session/types.js";
import { AgentEvent, AgentOptions, DEFAULT_MAX_INNER_ITERATIONS } from "./types.js";
import { RunLedgerEntry, capLedger, maxSeq, LEDGER_CAP } from "./ledger.js";
import { clearRateLimitRecord, getConsecutiveRateLimitCount, isCircuitOpen, isRateLimitMessage, noteRateLimited, rateLimitRetrySeconds, recordFailure, recordSuccess } from "../providers/freeModels.js";
import { MAX_DELEGATIONS_PER_TURN, runSubAgentLive } from "./subagent.js";
  import { interceptTurn } from "../guardian/interceptor.js";
import { TurnState } from "./turnState.js";
import { LoopGuard, type AccumulatedToolCall, type PreparedCall } from "./loopGuard.js";
import type { TeamRunResult } from "./team/types.js";
import { ToolOrchestrator, type RunnableCall } from "./orchestrator.js";
import { HistoryStore } from "./historyStore.js";
import {
  Checkpoint,
  summarizeSessionChangesFromBaseline,
  type SessionFileChange,
  capCheckpoints,
  checkpointMeta,
  takeSnapshot,
  restoreCheckpoint,
  type CheckpointMeta,
} from "./checkpoints.js";
import { loadCheckpoints, saveCheckpointsAsync } from "./checkpointStore.js";
import { BASELINE_MAX_BYTES, BASELINE_MAX_PATHS } from "../config/constants.js";

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
  private ledger: RunLedgerEntry[] = [];
  private ledgerSeq = 0;
  private lastUsage: { inputTokens: number; outputTokens: number } | null = null;
  // resolved tool list (sub-agents exclude delegate_task; MCP seam).
  // Per-turn counters (iterations, delegations, loop streaks) live in
  // TurnState, fresh per send() — never as session fields.
  private toolDefs: ToolDefinition[];
  // Rewind: in-memory ring of pre-mutation file snapshots (never persisted).
  private checkpoints: Checkpoint[] = [];
  // First-seen pre-mutation content per path across the WHOLE session. The
  // ring above is capped (CHECKPOINT_KEEP) and evicts the earliest snapshots;
  // this map never evicts, so /diff and the goal debrief keep reporting every
  // file the session touched even after many snapshots. Restore/rewind uses
  // the ring; the baseline is review-only.
  private baselineByPath = new Map<string, Buffer | null>();
  private baselineBytes = 0;
  /** Last completed delegate_task team run (Phase 25.2 introspection for /team status). */
  private lastTeamRun: TeamRunResult | null = null;
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
      // Rebuild the review baseline from whatever the persisted ring holds
      // (first-seen per path) — the best available after a restart.
      for (const cp of this.checkpoints) this.recordBaseline(cp);
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
    return summarizeSessionChangesFromBaseline(this.options.projectRoot, this.baselineByPath);
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
      this.recordBaseline({ ...cp, id: this.checkpointSeq });
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
    this.ledger.push({
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
    });
    if (this.ledger.length > LEDGER_CAP) {
      this.ledger = capLedger(this.ledger);
    }
  }

  /** Best-effort persist of the rewind ring. Awaited to avoid data loss on crash. */
  private async persistCheckpoints(): Promise<void> {
    await saveCheckpointsAsync(this.id, this.checkpoints);
  }

  /** Last completed team run, or null before any team delegation this session. */
  get teamRun(): TeamRunResult | null {
    return this.lastTeamRun;
  }

  /**
   * First-seen-per-path merge into the review baseline. A file previously
   * snapped (by a direct write or a merged sub-agent) keeps its ORIGINAL
   * content — the oldest snapshot per path is the session baseline. Bounded
   * by BASELINE_MAX_PATHS / BASELINE_MAX_BYTES (oldest-seen evicted first):
   * eviction only narrows /diff coverage, it never corrupts history.
   */
  private recordBaseline(cp: Checkpoint): void {
    for (const f of cp.files) {
      if (this.baselineByPath.has(f.path)) continue;
      this.baselineByPath.set(f.path, f.content);
      this.baselineBytes += f.content?.length ?? 0;
      while (
        this.baselineByPath.size > BASELINE_MAX_PATHS ||
        this.baselineBytes > BASELINE_MAX_BYTES
      ) {
        const oldest = this.baselineByPath.keys().next();
        if (oldest.done) break;
        const dropped = this.baselineByPath.get(oldest.value);
        this.baselineBytes -= dropped?.length ?? 0;
        this.baselineByPath.delete(oldest.value);
      }
    }
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

    // per-turn loop state starts clean on every send().
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

        // Reactive compaction: if the previous turn's input tokens crossed the
        // model's context-window threshold, summarize older history first.
        // Best-effort: a summarizer failure must never kill the turn, and a
        // second attempt later in the same turn would thrash history — so the
        // turn gets exactly one summarization ATTEMPT. The cheap guards are
        // peeked first: a below-threshold loop-top must not burn the attempt
        // (lastInputTokens is stale until the first round of THIS turn lands).
        const modelInfo = getModel(this.options.model, this.provider.id);
        // Free-form model ids are supported on purpose, so an unknown id must
        // still compact — a conservative default window beats dying on the
        // provider's real limit.
        const contextWindow = modelInfo?.contextWindow ?? FALLBACK_CONTEXT_WINDOW;
        if (
          !turn.compactedThisTurn &&
          this.lastInputTokens >= contextWindow * COMPACTION_THRESHOLD &&
          this.history.length > KEEP_RECENT_MESSAGES
        ) {
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
            // Summarization failed (or was aborted) — proceed uncompacted.
            // An abort surfaces as `cancelled` at the next loop-top check.
          }
        }

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
          const vOutcome = yield* verifyTurnMutations({
            projectRoot: this.options.projectRoot,
            autoVerify: this.options.autoVerify,
            mutationsOccurred: turn.mutationsOccurred,
            verifyRepairsUsed: turn.verifyRepairsUsed,
            maxVerifyRepairs: MAX_VERIFY_REPAIRS,
            signal: controller.signal,
            recordLedger: (e) => this.recordLedger(e),
            pushRepairPrompt: (msg) => this.history.pushUserText(msg),
          });

          if (vOutcome.status === "cancelled") {
            return;
          }
          if (vOutcome.status === "needs_repair") {
            turn.verifyRepairsUsed += 1;
            continue;
          }

          if (stopReason === "error") {
            yield {
              type: "error",
              message:
                "The model declined to complete this turn (content filter or safety block) — no usable response was produced.",
            };
            return;
          }

          recordSuccess(this.provider.id, this.options.model);
          yield { type: "turn_complete" };
          return;
        }

        turn.markIteration();

                const turnNotes: string[] = [];
        const prepared: PreparedCall[] = LoopGuard.classify(toolCalls, this.toolDefs, turn);
        const handled = new Map<string, ToolExecutionResult>();

        // ── Phase 25.6 → product: native guardian gate ─────────────────────
        // Intercept pending file mutations BEFORE they reach the orchestrator.
        // Safe auto-fixes rewrite the pending write content in place; surviving
        // violations refuse the offending calls only (same ToolExecutionResult
        // shape LoopGuard uses), the rest of the batch still runs, and a repair
        // prompt goes to the model — mirroring verifyTurnMutations.
        const fileWriteTools = new Set(["write_file", "edit_file"]);
        const pending: { call: PreparedCall; path: string; diff: string }[] = [];
        // Calls the guardian refused. They carry an error result in `handled`
        // and MUST be skipped by the dispatch loop below — putting them in
        // `toRun` anyway would execute the mutation the refusal promised not
        // to run (reported-vs-executed divergence, S1.1).
        const guardianBlocked = new Set<string>();
        for (const p of prepared) {
          if (!p.def?.mutating) continue;
          const input = (p.call.input ?? {}) as { path?: unknown; content?: unknown; new_str?: unknown };
          const relPath = typeof input.path === "string" ? input.path : undefined;
          if (!relPath) continue;
          let diff: string;
          if (fileWriteTools.has(p.def.name)) {
            const body =
              typeof input.content === "string"
                ? input.content
                : typeof input.new_str === "string"
                  ? input.new_str
                  : "";
            if (body.length === 0) continue;
            // describe-file tools: scan the literal new content (added lines).
            diff = body.split("\n").map((l) => `+${l}`).join("\n");
          } else {
            // Command-based mutations (bash, plugin tools): describeToolInput
            // is the sanctioned preview surface and returns a real unified
            // diff for file-touching commands. Empty = nothing to scan.
            diff = await describeToolInput(p.def.name, p.call.input, {
              projectRoot: this.options.projectRoot,
              signal: controller.signal,
            });
          }
          if (diff.length > 0) pending.push({ call: p, path: relPath, diff });
        }

        if (pending.length > 0) {
          const intercept = interceptTurn(pending.map((p) => ({ path: p.path, diff: p.diff })));
          if (intercept.fixed.length > 0) {
            // Auto-fix: raw-error ternary → getErrorMessage, applied back to the
            // pending content string so the call runs with the repaired text.
            const fixedByPath = new Map(intercept.fixed.map((f) => [f.path, f.diff]));
            for (const { call, path } of pending) {
              const repaired = fixedByPath.get(path);
              if (!repaired) continue;
              const fixedText = repaired.split("\n").map((l) => l.slice(1)).join("\n");
              const input = (call.call.input ?? {}) as { content?: string; new_str?: string };
              if (typeof input.content === "string") input.content = fixedText;
              else if (typeof input.new_str === "string") input.new_str = fixedText;
            }
          }
          if (!intercept.allowed) {
            const blockedByPath = new Set(intercept.violations.map((v) => v.file));
            for (const { call, path } of pending) {
              if (!blockedByPath.has(path)) continue;
              const callViolations = intercept.violations.filter((v) => v.file === path);
              guardianBlocked.add(call.call.id);
              handled.set(call.call.id, {
                output: {
                  error:
                    `Guardian blocked this call — pending changes to ${path} violate the project's hygiene rules: ` +
                    callViolations
                      .map((v) => `${v.rule} (line ${v.line}): ${v.detail}`)
                      .join("; ") +
                    ". Fix the violations and retry — do NOT re-emit the call unchanged.",
                },
                isError: true,
                summary: `Guardian blocked ${call.def?.name ?? "tool"} on ${path}`,
              });
              this.recordLedger({
                eventType: "loop_refused",
                tool: call.def?.name ?? "tool",
                inputHash: call.key,
                outcome: "error",
                elapsedMs: 0,
              });
            }
            yield {
              type: "guardian_blocked",
              count: blockedByPath.size,
              fixed: intercept.fixed.length,
              firstRule: intercept.violations[0]?.rule ?? "unknown",
            };
            this.history.pushUserText(
              `[Guardian] Your pending file mutation${intercept.violations.length === 1 ? " was" : "s were"} blocked before execution. ` +
                `Violations:\n` +
                intercept.violations.map((v) => `- ${v.file}: line ${v.line} — ${v.rule}: ${v.detail}`).join("\n") +
                `\nFix these issues (use getErrorMessage(err) for error formatting; never catch-and-ignore) and retry.`
            );
          }
        }
        // ───────────────────────────────────────────────────────────────────

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
                  this.recordLedger(entry as RunLedgerEntry);
                },
                allowDelegation: this.options.allowDelegation !== false,
                tryConsumeDelegation: (max: number) => turn.tryConsumeDelegation(max),
                provider: this.provider,
                model: this.options.model,
                projectRoot: this.options.projectRoot,
                permissionBroker: this.options.permissionBroker,
                tools: this.toolDefs,
                signal: controller.signal,
                mergeSubCheckpoints: async (cps: unknown[]) => {
                  await this.mergeSubCheckpoints(cps as Checkpoint[]);
                },
                recordMutation: () => {
                  turn.mutationsOccurred = true;
                },
                onTeamRunResult: (result) => {
                  this.lastTeamRun = result;
                },
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
            if (cancelled) {
              this.pushCancelledToolResults(prepared, handled, undefined, turnNotes);
              return;
            }
            handled.set(p.call.id, item.value);
            continue;
          }
          toRun.push({ p, startedAt: Date.now() });
        }

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
          return;
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

  private async *streamAssistantTurn(
    controller: AbortController,
    turn: TurnState
  ): AsyncGenerator<
    AgentEvent,
    {
      textParts: string[];
      toolCalls: AccumulatedToolCall[];
      stopReason: string | undefined;
      rateLimitRetry: number | null;
      sawUsage: boolean;
    } | null
  > {
    const stream = this.provider.streamCompletion({
      model: this.options.model,
      systemPrompt: this.options.systemPrompt,
      messages: this.history.snapshot(),
      tools: this.toolDefs,
      maxTokens: this.options.maxTokens,
      signal: controller.signal,
    });

    const textParts: string[] = [];
    const toolCalls: AccumulatedToolCall[] = [];
    const openCalls = new Map<string, { name: string; inputJson: string }>();
    let stopReason: string | undefined;
    let rateLimitRetry: number | null = null;
    let sawUsage = false;

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
                input = { __parseError: true, rawInput: raw.slice(0, 200) };
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
            ...(event.providerMetadata ? { providerMetadata: event.providerMetadata } : {}),
          });
          break;
        }
        case "usage":
          sawUsage = true;
          this.lastInputTokens = event.inputTokens;
          this.lastUsage = { inputTokens: event.inputTokens, outputTokens: event.outputTokens };
          yield { type: "usage", inputTokens: event.inputTokens, outputTokens: event.outputTokens };
          break;
        case "error": {
          if (isRateLimitMessage(event.message)) {
            noteRateLimited(this.provider.id, this.options.model);
            recordFailure(this.provider.id, this.options.model);
            if (!turn.rateLimitRetried) {
              turn.rateLimitRetried = true;
              const consecutive = getConsecutiveRateLimitCount(this.provider.id, this.options.model);
              rateLimitRetry = rateLimitRetrySeconds(event.message, consecutive);
              break;
            }
          }
          yield { type: "error", message: event.message };
          return null;
        }
        case "turn_end":
          stopReason = event.stopReason;
          break;
      }
    }

    return { textParts, toolCalls, stopReason, rateLimitRetry, sawUsage };
  }

  private async takeRewindSnapshot(prepared: PreparedCall[]): Promise<Checkpoint | null> {
    const rewindTargets = [...new Set(prepared.flatMap((p) => {
      if (p.call.name !== "write_file" && p.call.name !== "edit_file") return [];
      const target = (p.call.input as { path?: unknown } | undefined)?.path;
      return typeof target === "string" && target.length > 0 ? [target] : [];
    }))];
    if (rewindTargets.length === 0) return null;
    const cp = await takeSnapshot(this.options.projectRoot, this.checkpointSeq + 1, rewindTargets);
    if (cp.files.length > 0) {
      this.recordBaseline(cp);
      return cp;
    }
    return null;
  }

  private async commitRewindSnapshot(
    pendingCp: Checkpoint,
    prepared: PreparedCall[],
    outcomes: Map<string, ToolExecutionResult>
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
    const committedFiles = pendingCp.files.filter((f) => succeededPaths.has(f.path));
    if (committedFiles.length === 0) return null;
    const committed: Checkpoint = { ...pendingCp, files: committedFiles };
    this.checkpointSeq = pendingCp.id;
    this.checkpoints = capCheckpoints([...this.checkpoints, committed]);
    await this.persistCheckpoints();
    this.recordLedger({ eventType: "checkpoint_created", outcome: "ok", elapsedMs: 0 });
    return { type: "checkpoint", id: committed.id, files: committed.files.length };
  }
}
