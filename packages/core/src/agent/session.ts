import { randomUUID } from "node:crypto";
import { ConversationMessage, ModelProvider, StreamEvent } from "../providers/types.js";
import { MODEL_REGISTRY } from "../providers/registry.js";
import { TOOL_DEFINITIONS, executeTool, describeToolInput } from "../tools/index.js";
import { compactIfNeeded } from "./compaction.js";
import { SessionMetadata, StoredSession } from "../session/types.js";
import { AgentEvent, AgentOptions } from "./types.js";

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
  private provider: ModelProvider;
  private options: AgentOptions;
  // The previous turn's input token count — compaction uses it reactively
  // (see the known limitation in docs/PHASE-5-NOTES.md).
  private lastInputTokens = 0;
  readonly id: string;
  title: string | null; // null until the first user message sets a default
  readonly createdAt: string;

  constructor(
    provider: ModelProvider,
    options: AgentOptions,
    restore?: RestoreData
  ) {
    this.provider = provider;
    this.options = options;
    this.id = restore?.metadata.id ?? randomUUID();
    this.title = restore?.metadata.title ?? null;
    this.createdAt = restore?.metadata.createdAt ?? new Date().toISOString();
    if (restore) this.history = [...restore.history];
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
      },
      history: [...this.history],
    };
  }

  async *send(userText: string): AsyncGenerator<AgentEvent> {
    this.history.push({ role: "user", content: [{ type: "text", text: userText }] });
    // Set a default title from the first user message so sessions aren't stuck
    // as "Untitled" without extra wiring.
    if (this.title === null) {
      this.title = userText.length > 50 ? userText.slice(0, 49) + "…" : userText;
    }
    // A fresh controller per send() call — cancelling one turn must not poison the next.
    const controller = new AbortController();
    this.currentController = controller;

    try {
      while (true) {
        if (controller.signal.aborted) {
          yield { type: "cancelled" };
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
            this.options.model
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
          tools: TOOL_DEFINITIONS,
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
              yield { type: "usage", inputTokens: event.inputTokens, outputTokens: event.outputTokens };
              break;
            case "error":
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

        // Execute each tool call (permission-gating mutating ones), collect
        // results as a single user-role tool_result message, then loop.
        const resultContent: ConversationMessage["content"] = [];
        for (const call of toolCalls) {
          if (controller.signal.aborted) {
            yield { type: "cancelled" };
            return;
          }

          const def = TOOL_DEFINITIONS.find((d) => d.name === call.name);
          if (!def) {
            const msg = `Unknown tool: ${call.name}`;
            const result = { output: { error: msg }, isError: true, summary: msg };
            yield { type: "tool_finished", id: call.id, name: call.name, result };
            resultContent.push({
              type: "tool_result",
              result: { toolCallId: call.id, content: JSON.stringify(result.output), isError: true },
            });
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
              yield { type: "cancelled" };
              return;
            }
            if (!approved) {
              yield { type: "tool_permission_denied", id: call.id, name: call.name };
              // The model MUST be told the action did not happen — never swallow it.
              resultContent.push({
                type: "tool_result",
                result: {
                  toolCallId: call.id,
                  content: JSON.stringify({
                    error: "Permission denied by user. The action was NOT performed.",
                  }),
                  isError: true,
                },
              });
              continue;
            }
          }

          yield { type: "tool_started", id: call.id, name: call.name, input: call.input };
          const result = await executeTool(call.name, call.input, {
            projectRoot: this.options.projectRoot,
            signal: controller.signal,
          });
          yield { type: "tool_finished", id: call.id, name: call.name, result };
          resultContent.push({
            type: "tool_result",
            result: {
              toolCallId: call.id,
              content: JSON.stringify(result.output),
              isError: result.isError,
            },
          });
        }
        this.history.push({ role: "user", content: resultContent });
      }
    } catch (err: any) {
      if (controller.signal.aborted) {
        yield { type: "cancelled" };
        return;
      }
      yield { type: "error", message: err?.message ?? String(err) };
    } finally {
      this.currentController = null;
    }
  }
}
