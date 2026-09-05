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

  constructor(initial?: ConversationMessage[]) {
    this.messages = initial ? [...initial] : [];
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
  }

  get length(): number {
    return this.messages.length;
  }

  pushUserText(text: string): void {
    this.messages.push({ role: "user", content: [{ type: "text", text }] });
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
  }

  /**
   * Close the turn: tool results rebuilt in EXACTLY declared call order
   * (provider replay stability is non-negotiable whatever the execution
   * path), with loop-guard notes leading as user-role text in the SAME
   * message (a separate user message between tool_call and tool_result
   * would break Gemini's functionResponse adjacency).
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
    const parts: ConversationMessage["content"] = [];
    if (turnNotes.length > 0) parts.push({ type: "text", text: turnNotes.join("\n") });
    parts.push(...ordered);
    this.messages.push({ role: "user", content: parts });
  }
}
