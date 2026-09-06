import { ConversationMessage, ModelProvider } from "../providers/types.js";

export interface CompactionResult {
  compacted: boolean;
  summary?: string;
}

export const COMPACTION_THRESHOLD = 0.75; // fraction of context window that triggers compaction
export const KEEP_RECENT_MESSAGES = 6; // most recent messages kept verbatim, never summarized

/**
 * Fold a compacted history ([summary(user), ...recent]) to preserve role
 * alternation: if the kept tail also starts with a user message (reachable
 * after empty tool-result pushes, error/abort tails, or legacy resumed
 * histories), merge the summary text into it instead of pushing two
 * consecutive users — several providers reject that shape. Pure.
 */
export function mergeSummaryIntoHistory(
  compacted: ConversationMessage[]
): ConversationMessage[] {
  const [first, ...rest] = compacted;
  if (
    first &&
    rest.length > 0 &&
    first.role === "user" &&
    rest[0].role === "user"
  ) {
    return [{ role: "user", content: [...first.content, ...rest[0].content] }, ...rest.slice(1)];
  }
  return compacted;
}

/**
 * Rough token floor for a history the session has no measured usage for
 * (resumed sessions). ~4 chars/token is a conservative underestimate for
 * prose and code alike — good enough to decide "this history is dangerously
 * large, compact BEFORE the first request", which the reactive path cannot
 * see because it only acts on measured counts from a completed stream.
 * Images carry no text, so each counts as a fixed token floor (a
 * full-bleed vision image costs ≥ ~1.5k tokens on every provider we ship);
 * without this, an image-heavy resumed history under-seeds and the first
 * request dies on the provider's context limit.
 */
const IMAGE_TOKEN_FLOOR = 2000;

export function estimateTokens(messages: ConversationMessage[]): number {
  let chars = 0;
  let images = 0;
  for (const m of messages) {
    for (const c of m.content) {
      if (c.type === "text") chars += c.text.length;
      else if (c.type === "image") images += 1;
      else if (c.type === "tool_call") chars += JSON.stringify(c.call.input ?? {}).length;
      else if (c.type === "tool_result") chars += c.result.content.length;
    }
  }
  return Math.ceil(chars / 4) + images * IMAGE_TOKEN_FLOOR;
}

export async function compactIfNeeded(
  history: ConversationMessage[],
  contextWindow: number,
  latestInputTokens: number,
  provider: ModelProvider,
  model: string,
  signal?: AbortSignal
): Promise<{ history: ConversationMessage[]; result: CompactionResult }> {
  if (latestInputTokens < contextWindow * COMPACTION_THRESHOLD) {
    return { history, result: { compacted: false } };
  }
  if (history.length <= KEEP_RECENT_MESSAGES) {
    // Nothing safe to summarize away — let the caller proceed and possibly hit a real
    // max-context error; this is an edge case (a handful of enormous messages), not the
    // common path this feature targets.
    return { history, result: { compacted: false } };
  }

  const toSummarize = history.slice(0, history.length - KEEP_RECENT_MESSAGES);
  const recent = history.slice(history.length - KEEP_RECENT_MESSAGES);

  const summaryText = await summarizeMessages(toSummarize, provider, model, signal);
  if (!summaryText.trim()) {
    // An empty summary is worse than no compaction: it would replace real
    // history with a placeholder. Report no-op and let the turn proceed.
    return { history, result: { compacted: false } };
  }

  const summaryMessage: ConversationMessage = {
    role: "user",
    content: [
      {
        type: "text",
        text: `[Earlier conversation summary, for context]\n${summaryText}`,
      },
    ],
  };

  return {
    history: [summaryMessage, ...recent],
    result: { compacted: true, summary: summaryText },
  };
}

async function summarizeMessages(
  messages: ConversationMessage[],
  provider: ModelProvider,
  model: string,
  signal?: AbortSignal
): Promise<string> {
  // One non-streaming-in-spirit call (still uses streamCompletion, just collects all
  // text_delta events into one string) asking the model to summarize `messages` concisely,
  // preserving anything a later turn would need: decisions made, files touched, open questions.
  // No tools, no system prompt beyond the summarization instruction itself.
  let text = "";
  const stream = provider.streamCompletion({
    model,
    systemPrompt:
      "Summarize the following coding-session conversation concisely. Preserve: decisions " +
      "made, files created or modified and why, and any unresolved questions. Omit pleasantries " +
      "and restating tool output verbatim.",
    messages,
    tools: [],
    maxTokens: 1024,
    signal,
  });
  for await (const event of stream) {
    if (event.type === "text_delta") text += event.text;
  }
  return text;
}
