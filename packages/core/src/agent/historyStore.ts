import type { ConversationMessage } from "../providers/types.js";
import type { ToolExecutionResult } from "../tools/types.js";
import { mergeSummaryIntoHistory } from "./compaction.js";
import type { AccumulatedToolCall, PreparedCall } from "./loopGuard.js";

/**
 * Sole writer of the conversation history array. Owns the append invariants:
 * no empty pushes, no `system` role (the model has none), provider-replay
 * order (declared call order, turn notes leading as user text).
 */
export class HistoryStore {
  private messages: ConversationMessage[];
  /** Indices of messages pushed via pushUserText — the anchors /retry unwinds to. */
  private userTurnIndices: number[] = [];

  constructor(initial?: ConversationMessage[]) {
    this.messages = initial ? [...initial] : [];
    if (initial) this.rescanUserTurns();
  }

  /**
   * A "user turn" is a user message with leading text and no tool_result
   * parts (turn-notes messages ride with tool results; the compaction
   * summary is context, not a request). Rebuilt by scan for restored
   * histories where push-order bookkeeping is gone.
   */
  private rescanUserTurns(): void {
    this.userTurnIndices = [];
    this.messages.forEach((m, i) => {
      if (
        m.role === "user" &&
        !m.content.some((c) => c.type === "tool_result") &&
        m.content.some((c) => c.type === "text") &&
        !(m.content.find((c) => c.type === "text") as { text: string }).text.startsWith(
          "[Earlier conversation summary"
        )
      ) {
        this.userTurnIndices.push(i);
      }
    });
  }

  /** Read-only snapshot for provider requests (never the live array). */
  snapshot(): ConversationMessage[] {
    return [...this.messages];
  }

  get(): readonly ConversationMessage[] {
    return [...this.messages];
  }

  replaceAll(messages: ConversationMessage[]): void {
    this.messages = [...messages];
  }

  clear(): void {
    this.messages = [];
    this.userTurnIndices = [];
  }

  get length(): number {
    return this.messages.length;
  }

  pushUserText(text: string, images: { mediaType: string; data: string }[] = []): void {
    this.userTurnIndices.push(this.messages.length);
    this.messages.push({
      role: "user",
      content: [
        ...images.map((img) => ({ type: "image" as const, mediaType: img.mediaType, data: img.data })),
        { type: "text", text },
      ],
    });
  }

  /**
   * The budget notice MUST be assistant-role: the history model has no
   * `system` role and role alternation must stay valid for every provider.
   */
  pushBudgetNotice(maxInnerIterations: number): void {
    this.messages.push({
      role: "assistant",
      content: [
        {
          type: "text",
          text: `I reached this turn's step limit (${maxInnerIterations}). Here is where I am and what remains; tell me to continue.`,
        },
      ],
    });
  }

  /**
   * Record one assistant turn. Returns false (pushing nothing) when the turn
   * produced neither text nor tool calls — an empty message would corrupt
   * provider replay and length assertions.
   */
  pushAssistant(textParts: string[], toolCalls: AccumulatedToolCall[]): boolean {
    const assistantContent: ConversationMessage["content"] = [];
    const text = textParts.join("");
    if (text) assistantContent.push({ type: "text", text });
    for (const call of toolCalls) {
      assistantContent.push({ type: "tool_call", call });
    }
    if (assistantContent.length === 0) return false;
    this.messages.push({ role: "assistant", content: assistantContent });
    return true;
  }

  applyCompacted(compacted: ConversationMessage[]): void {
    this.messages = mergeSummaryIntoHistory(compacted);
    this.rescanUserTurns();
  }

  /**
   * /retry: drop the last user turn AND everything after it (its answer, any
   * tool calls/results in between), returning the request text so the caller
   * can re-send it. Null when there is no user turn to unwind.
   */
  popLastUserTurn(): string | null {
    while (this.userTurnIndices.length > 0) {
      const idx = this.userTurnIndices.pop()!;
      if (idx < this.messages.length) {
        const text = this.messages[idx].content
          .filter((c) => c.type === "text")
          .map((c) => (c as { text: string }).text)
          .join("\n");
        this.messages.length = idx;
        this.userTurnIndices = this.userTurnIndices.filter((i) => i < idx);
        return text;
      }
    }
    return null;
  }

  /**
   * Close the turn: tool results rebuilt in EXACTLY declared call order
   * (provider replay stability is non-negotiable whatever the execution
   * path), with any loop-guard notes trailing as user-role text in the SAME
   * message (a separate user message between tool_call and tool_result would
   * break Gemini's functionResponse adjacency). Results must come FIRST
   * within the message: Anthropic requires tool_result blocks at the start of
   * the user turn, and OpenAI-family providers reject a user text message
   * interleaved between assistant tool_calls and their role:"tool" replies.
   */
  pushToolResults(
    prepared: readonly PreparedCall[],
    outcomes: ReadonlyMap<string, ToolExecutionResult>,
    turnNotes: readonly string[]
  ): void {
    const ordered: ConversationMessage["content"] = [];
    for (const p of prepared) {
      const outcome = outcomes.get(p.call.id);
      if (outcome) {
        ordered.push({
          type: "tool_result",
          result: { toolCallId: p.call.id, content: JSON.stringify(outcome.output), isError: outcome.isError },
        });
      }
    }
    const parts: ConversationMessage["content"] = [...ordered];
    if (turnNotes.length > 0) parts.push({ type: "text", text: turnNotes.join("\n") });
    // A declared `tool_use` turn can yield zero tool_call_end parts (e.g. a
    // stop-reason with no content blocks). Pushing an empty user message would
    // corrupt provider replay (malformed payloads, broken alternation) — skip it.
    if (parts.length === 0) return;
    this.messages.push({ role: "user", content: parts });
  }

  /**
   * Check if the history ends with an assistant message containing tool calls
   * that were never answered with tool_result parts in a subsequent user message.
   * If so, closes the tool calls with synthetic error tool_results and appends
   * an assistant error notice so role alternation is preserved and providers
   * do not reject the history on subsequent turns.
   */
  repairUnclosedToolCalls(errorMessage: string): boolean {
    if (this.messages.length === 0) return false;
    const last = this.messages[this.messages.length - 1];
    if (last.role !== "assistant") return false;
    const toolCalls = last.content.filter(
      (c): c is { type: "tool_call"; call: AccumulatedToolCall } => c.type === "tool_call"
    );
    if (toolCalls.length === 0) return false;

    const parts: ConversationMessage["content"] = toolCalls.map((tc) => ({
      type: "tool_result",
      result: {
        toolCallId: tc.call.id,
        content: JSON.stringify({ error: `Tool execution aborted: ${errorMessage}` }),
        isError: true,
      },
    }));
    this.messages.push({ role: "user", content: parts });
    this.messages.push({
      role: "assistant",
      content: [{ type: "text", text: `Turn failed: ${errorMessage}` }],
    });
    return true;
  }
}
