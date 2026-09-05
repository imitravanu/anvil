import { randomUUID } from "node:crypto";
import { ConversationMessage, ModelProvider, StreamEvent } from "../providers/types.js";
import { MODEL_REGISTRY } from "../providers/registry.js";
import { TOOL_DEFINITIONS, executeTool, describeToolInput } from "../tools/index.js";
import type { ToolExecutionResult, ToolDefinition } from "../tools/types.js";
import { compactIfNeeded } from "./compaction.js";
import { SessionMetadata, StoredSession } from "../session/types.js";
import { AgentEvent, AgentOptions, DEFAULT_MAX_INNER_ITERATIONS } from "./types.js";
import { canonicalInputHash } from "./canonical.js";
import { RunLedgerEntry, capLedger, maxSeq } from "./ledger.js";
import { isRateLimitMessage, noteRateLimited } from "../providers/freeModels.js";
import { MAX_DELEGATIONS_PER_TURN, runSubAgent } from "./subagent.js";
import {
  Checkpoint,
  capCheckpoints,
  checkpointMeta,
  takeSnapshot,
  restoreCheckpoint,
  type CheckpointMeta,
} from "./checkpoints.js";

interface AccumulatedToolCall {
  id: string;
  name: string;
  input: unknown;
  providerMetadata?: Record<string, unknown>;
}

export interface RestoreData {
  metadata: SessionMetadata;
  history: ConversationMessage[];
}

export class AgentSession {
  private history: ConversationMessage[] = [];
  private currentController: AbortController | null = null;
  private isSending = false;
  private provider: ModelProvider;
  private options: AgentOptions;
  // The previous turn's input token count — compaction uses it reactively
  // (see the known limitation in docs/PHASE-5-NOTES.md).
  private lastInputTokens = 0;
  // Phase 8 (A.1): durable-loop state.
  readonly maxInnerIterations: number;
  /** Current plan, set by the update_plan tool; persists on save. */
  plan: string | null = null;
  private iterationsUsed = 0;
  private ledger: RunLedgerEntry[] = [];
  private ledgerSeq = 0;
  private lastUsage: { inputTokens: number; outputTokens: number } | null = null;
  // Phase 9: resolved tool list + per-turn delegation counter.
  private toolDefs: ToolDefinition[];
  private delegationsUsed = 0;
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
    // Phase 9: delegation is ON unless explicitly disabled (sub-agents pass
    // false — the real depth guard; a filtered tool list only stops a
    // well-behaved model, per the PHASE-9 spec gotcha).
    this.options = { ...options, allowDelegation: options.allowDelegation ?? true };
    this.maxInnerIterations = options.maxInnerIterations ?? DEFAULT_MAX_INNER_ITERATIONS;
    // Phase 9: tool-list override (sub-agents exclude delegate_task; MCP seam).
    this.toolDefs = options.tools ?? TOOL_DEFINITIONS;
    this.id = restore?.metadata.id ?? randomUUID();
    this.title = restore?.metadata.title ?? null;
    this.createdAt = restore?.metadata.createdAt ?? new Date().toISOString();
    if (restore) {
      this.history = [...restore.history];
      this.plan = restore.metadata.plan ?? null;
      this.ledger = capLedger(restore.metadata.runLedger ?? []);
      this.ledgerSeq = maxSeq(this.ledger);
    }
  }

  /** Read-only view of the conversation history (exposed for tests / future phases). */
  getHistory(): readonly ConversationMessage[] {
    return this.history;
  }

  cancel(): void {
    this.currentController?.abort();
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
      this.history = [];
    }
    return { historyCleared: providerChanged };
  }

  /** Wipe conversation history (the `/clear` command). */
  clearHistory(): void {
    this.history = [];
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
        // Phase 8 (A.1.4/A.1.5): plan + run ledger persist so a resumed session
        // tells the truth about what the previous run did.
        ...(this.plan !== null ? { plan: this.plan } : {}),
        ...(this.ledger.length > 0 ? { runLedger: capLedger(this.ledger) } : {}),
      },
      history: [...this.history],
    };
  }

  /** Phase 8 (A.1.5): read-only view of this session's run ledger. */
  getRunLedger(): readonly RunLedgerEntry[] {
    return this.ledger;
  }

  /** Rewind: metadata view of in-memory checkpoints (contents never exposed). */
  getCheckpoints(): CheckpointMeta[] {
    return this.checkpoints.map(checkpointMeta);
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
        // Measured usage rides along when available (record, never predict) —
        // explicit tokens (e.g. a sub-agent's own usage) take precedence.
        ...(entry.tokens ??
          (this.lastUsage
            ? { tokens: { in: this.lastUsage.inputTokens, out: this.lastUsage.outputTokens } }
            : {})),
        seq: this.ledgerSeq,
        ts: new Date().toISOString(),
      },
    ]);
  }

  async *send(userText: string): AsyncGenerator<AgentEvent> {
    if (this.isSending) {
      yield { type: "error", message: "A turn is already in progress for this session." };
      return;
    }
    this.isSending = true;
    this.history.push({ role: "user", content: [{ type: "text", text: userText }] });
    if (this.title === null) {
      const firstLine = userText.trim().split("\n")[0] ?? "";
      const chars = Array.from(firstLine);
      this.title = chars.length > 50 ? chars.slice(0, 49).join("") + "…" : firstLine;
    }
    // A fresh controller per send() call — cancelling one turn must not poison the next.
    const controller = new AbortController();
    this.currentController = controller;

    // Phase 8 (A.1): per-turn loop state starts clean on every send().
    this.iterationsUsed = 0;
    this.delegationsUsed = 0;
    let lastToolKey: string | null = null;
    let toolStreak = 0;
    let loopNotified = false;
    // Total per-key counts this turn, for the non-consecutive repeat guard.
    const totalCounts = new Map<string, number>();

    try {
      while (true) {
        if (controller.signal.aborted) {
          yield { type: "cancelled" };
          return;
        }

        // Phase 8 (A.1.1): iteration budget — never run unbounded, never truncate
        // silently. The notice is an assistant-role message because the history
        // model has no "system" role and role alternation must stay valid for every
        // provider (recorded in docs/PHASE-8-PROGRESS.md).
        if (this.iterationsUsed >= this.maxInnerIterations) {
          this.recordLedger({ eventType: "budget_exhausted", outcome: "aborted", elapsedMs: 0 });
          yield { type: "budget_exhausted" };
          this.history.push({
            role: "assistant",
            content: [
              {
                type: "text",
                text: `I reached this turn's step limit (${this.maxInnerIterations}). Here is where I am and what remains; tell me to continue.`,
              },
            ],
          });
          return;
        }

        // Reactive compaction: if the previous turn's input tokens crossed the
        // model's context-window threshold, summarize older history first.
        const modelInfo = MODEL_REGISTRY.find((m) => m.id === this.options.model);
        if (modelInfo && this.lastInputTokens > 0) {
          const { history: compacted, result } = await compactIfNeeded(
            this.history,
            modelInfo.contextWindow,
            this.lastInputTokens,
            this.provider,
            this.options.model,
            controller.signal
          );
          if (result.compacted) {
            this.history = compacted;
            yield { type: "compacted", summary: result.summary! };
          }
        }

        const stream = this.provider.streamCompletion({
          model: this.options.model,
          systemPrompt: this.options.systemPrompt,
          messages: [...this.history], // snapshot — never expose the live array to the provider
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
              if (open) open.inputJson = event.partialInputJson;
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
            case "error":
              // Phase 8 (B): record rate-limit/quota signals — NO backoff yet.
              if (isRateLimitMessage(event.message)) {
                noteRateLimited(this.provider.id, this.options.model);
              }
              yield { type: "error", message: event.message };
              return;
            case "turn_end":
              stopReason = event.stopReason;
              break;
          }
        }

        if (controller.signal.aborted) {
          yield { type: "cancelled" };
          return;
        }

        // Record the assistant turn (text and/or tool_use blocks) in history
        // before anything else — including for plain text turns, which must
        // still be part of the conversation the provider sees next turn.
        const assistantContent: ConversationMessage["content"] = [];
        const text = textParts.join("");
        if (text) assistantContent.push({ type: "text", text });
        for (const call of toolCalls) {
          assistantContent.push({ type: "tool_call", call });
        }
        if (assistantContent.length > 0) {
          this.history.push({ role: "assistant", content: assistantContent });
        }

        if (stopReason !== "tool_use") {
          yield { type: "turn_complete" };
          return;
        }

        // Phase 8 (A.1): bounded, loop-safe, ordered tool orchestration.
        this.iterationsUsed += 1;

        const turnNotes: string[] = [];
        type PreparedCall = {
          call: AccumulatedToolCall;
          def: ToolDefinition | undefined;
          key: string;
          refused: boolean;
          loopWarn: boolean;
          repeatWarn: boolean;
        };
        // Classify in DECLARED order first: the consecutive same-key streak
        // (A.1.2) and the declared-order contract (F5) are order-sensitive.
        const prepared: PreparedCall[] = toolCalls.map((call) => {
          const def = this.toolDefs.find((d) => d.name === call.name);
          const key = `${call.name}:${canonicalInputHash(call.input)}`;
          if (key === lastToolKey) toolStreak += 1;
          else {
            toolStreak = 1;
            lastToolKey = key;
          }
          const loopWarn = toolStreak === 3 && !loopNotified;
          if (loopWarn) loopNotified = true;
          // Non-consecutive repeat (A-B-A-B-A ping-pong the streak guard cannot
          // see): 3rd TOTAL occurrence with other calls in between. Warn once
          // per turn, never refuse — interleaved repeats are often legitimate
          // re-reads, so this stays advisory while the consecutive guard stays
          // the enforcing one.
          const total = (totalCounts.get(key) ?? 0) + 1;
          totalCounts.set(key, total);
          const repeatWarn = total === 3 && !loopWarn && toolStreak < 3 && !loopNotified;
          if (repeatWarn) loopNotified = true;
          return { call, def, key, refused: toolStreak >= 4, loopWarn, repeatWarn };
        });

        // update_plan is handled by the session (sets this.plan + emits
        // plan_updated) and never runs the generic executor; refused loop calls
        // never run at all.
        const handled = new Map<string, ToolExecutionResult>();
        const toRun: { p: PreparedCall; startedAt: number }[] = [];
        for (const p of prepared) {
          if (p.loopWarn) {
            this.recordLedger({ eventType: "loop_detected", tool: p.call.name, inputHash: p.key, outcome: "error", elapsedMs: 0 });
            yield { type: "loop_detected", tool: p.call.name };
            turnNotes.push(
              `[Loop guard] ${p.call.name} was repeated 3 times without progress. Stop repeating it and try a different approach.`
            );
          }
          if (p.repeatWarn) {
            this.recordLedger({ eventType: "loop_detected", tool: p.call.name, inputHash: p.key, outcome: "error", elapsedMs: 0 });
            yield { type: "loop_detected", tool: p.call.name };
            turnNotes.push(
              `[Loop guard] ${p.call.name} was repeated 3 times this turn (with other calls in between) without progress. Stop repeating it and try a different approach.`
            );
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
            // Phase 9: sub-agent delegation — intercepted like update_plan and
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
            if (this.delegationsUsed >= MAX_DELEGATIONS_PER_TURN) {
              this.recordLedger({ eventType: "tool_finished", tool: "delegate_task", inputHash: p.key, outcome: "error", elapsedMs: 0 });
              handled.set(p.call.id, {
                output: { error: `Delegation limit reached (${MAX_DELEGATIONS_PER_TURN} per turn).` },
                isError: true,
                summary: "Delegation limit reached.",
              });
              continue;
            }
            this.delegationsUsed += 1;
            this.recordLedger({ eventType: "subagent_started", tool: "delegate_task", inputHash: p.key, outcome: "ok", elapsedMs: 0 });
            yield { type: "subagent_started", task };
            const subStartedAt = Date.now();
            const run = await runSubAgent({
              provider: this.provider,
              model: this.options.model,
              projectRoot: this.options.projectRoot,
              permissionBroker: this.options.permissionBroker,
              task,
              signal: controller.signal,
              // Phase 10: sub-agents inherit the main session's tools (incl.
              // MCP) minus delegate_task, under the same shared broker.
              tools: this.toolDefs,
            });
            if (run.aborted) {
              this.recordLedger({ eventType: "cancelled", tool: "delegate_task", inputHash: p.key, outcome: "aborted", elapsedMs: Date.now() - subStartedAt });
              yield { type: "cancelled" };
              return;
            }
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
            handled.set(p.call.id, {
              output: { error: "Repeated identical call blocked by loop guard." },
              isError: true,
              summary: "Repeated identical call blocked by loop guard.",
            });
            continue;
          }
          toRun.push({ p, startedAt: Date.now() });
        }
        // Rewind: snapshot write_file/edit_file targets BEFORE any permission
        // prompt or execution. Matched by NAME, pre-permission — a denied tool
        // changes nothing, so restoring over it stays correct. Batches with no
        // file writes (reads, run_command-only) snapshot nothing.
        const rewindTargets: string[] = [];
        for (const p of prepared) {
          if (p.call.name !== "write_file" && p.call.name !== "edit_file") continue;
          const target = (p.call.input as { path?: unknown } | undefined)?.path;
          if (typeof target === "string" && target.length > 0) rewindTargets.push(target);
        }
        if (rewindTargets.length > 0) {
          const cp = takeSnapshot(this.options.projectRoot, this.checkpointSeq + 1, rewindTargets);
          if (cp.files.length > 0) {
            this.checkpointSeq = cp.id;
            this.checkpoints = capCheckpoints([...this.checkpoints, cp]);
            this.recordLedger({ eventType: "checkpoint_created", outcome: "ok", elapsedMs: 0 });
            yield { type: "checkpoint", id: cp.id, files: cp.files.length };
          }
        }
        // A.1.3 declared parallel policy: any mutating call forces the WHOLE batch
        // serial (single-flight permission prompts; no file/command races). An
        // all-read-only batch runs concurrently, then results are re-ordered.
        const anyMutating = toRun.some((t) => t.p.def?.mutating);
        const runResults = new Map<string, ToolExecutionResult>();
        if (anyMutating || toRun.length <= 1) {
          for (const t of toRun) {
            const { call, def } = t.p;
            if (controller.signal.aborted) {
              this.recordLedger({ eventType: "cancelled", tool: call.name, inputHash: t.p.key, outcome: "aborted", elapsedMs: 0 });
              yield { type: "cancelled" };
              return;
            }
            if (!def) {
              const msg = `Unknown tool: ${call.name}`;
              const result: ToolExecutionResult = { output: { error: msg }, isError: true, summary: msg };
              yield { type: "tool_finished", id: call.id, name: call.name, result };
              this.recordLedger({ eventType: "tool_finished", tool: call.name, inputHash: t.p.key, outcome: "error", elapsedMs: Date.now() - t.startedAt });
              runResults.set(call.id, result);
              continue;
            }
            if (def.mutating) {
              let summary = `${call.name}`;
              try {
                summary = await describeToolInput(call.name, call.input, {
                  projectRoot: this.options.projectRoot,
                  signal: controller.signal,
                });
              } catch {
                // preview failure must not block the permission flow
              }
              let approved = false;
              try {
                approved = await this.options.permissionBroker.requestPermission(def.name, summary);
              } catch {
                approved = false; // a broken broker denies by default
              }
              if (controller.signal.aborted) {
                this.recordLedger({ eventType: "cancelled", tool: call.name, inputHash: t.p.key, outcome: "aborted", elapsedMs: 0 });
                yield { type: "cancelled" };
                return;
              }
              if (!approved) {
                this.recordLedger({ eventType: "tool_permission_denied", tool: call.name, inputHash: t.p.key, outcome: "denied", elapsedMs: Date.now() - t.startedAt });
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
            this.recordLedger({ eventType: "tool_started", tool: call.name, inputHash: t.p.key, outcome: "ok", elapsedMs: 0 });
            const result = await executeTool(call.name, call.input, {
              projectRoot: this.options.projectRoot,
              signal: controller.signal,
            });
            yield { type: "tool_finished", id: call.id, name: call.name, result };
            this.recordLedger({ eventType: "tool_finished", tool: call.name, inputHash: t.p.key, outcome: result.isError ? "error" : "ok", elapsedMs: Date.now() - t.startedAt });
            runResults.set(call.id, result);
          }
        } else {
          // Concurrent read-only batch — the shared AbortSignal reaches every call.
          for (const t of toRun) {
            yield { type: "tool_started", id: t.p.call.id, name: t.p.call.name, input: t.p.call.input };
            this.recordLedger({ eventType: "tool_started", tool: t.p.call.name, inputHash: t.p.key, outcome: "ok", elapsedMs: 0 });
          }
          const outputs = await Promise.all(
            toRun.map((t) =>
              executeTool(t.p.call.name, t.p.call.input, {
                projectRoot: this.options.projectRoot,
                signal: controller.signal,
              })
            )
          );
          for (let i = 0; i < toRun.length; i++) {
            const t = toRun[i];
            const result = outputs[i];
            yield { type: "tool_finished", id: t.p.call.id, name: t.p.call.name, result };
            this.recordLedger({ eventType: "tool_finished", tool: t.p.call.name, inputHash: t.p.key, outcome: result.isError ? "error" : "ok", elapsedMs: Date.now() - t.startedAt });
            runResults.set(t.p.call.id, result);
          }
          if (controller.signal.aborted) {
            this.recordLedger({ eventType: "cancelled", outcome: "aborted", elapsedMs: 0 });
            yield { type: "cancelled" };
            return;
          }
        }

        // Rebuild the tool_result message in EXACTLY the declared call order —
        // provider replay stability (F5) is non-negotiable whatever the path.
        const ordered: ConversationMessage["content"] = [];
        for (const p of prepared) {
          const outcome = handled.get(p.call.id) ?? runResults.get(p.call.id);
          if (outcome) {
            ordered.push({
              type: "tool_result",
              result: { toolCallId: p.call.id, content: JSON.stringify(outcome.output), isError: outcome.isError },
            });
          }
        }
        // Loop-guard demands lead the results message as a user-role text part
        // (the data model has no "system" role; recorded in PHASE-8-PROGRESS.md).
        const parts: ConversationMessage["content"] = [];
        if (turnNotes.length > 0) parts.push({ type: "text", text: turnNotes.join("\n") });
        parts.push(...ordered);
        this.history.push({ role: "user", content: parts });
      }
    } catch (err: any) {
      if (controller.signal.aborted) {
        yield { type: "cancelled" };
        return;
      }
      if (isRateLimitMessage(err?.message ?? String(err))) {
        noteRateLimited(this.provider.id, this.options.model);
      }
      yield { type: "error", message: err?.message ?? String(err) };
    } finally {
      if (this.currentController === controller) this.currentController = null;
      this.isSending = false;
    }
  }
}
