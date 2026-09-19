import { ConversationMessage, ModelProvider } from "../providers/types.js";
import { selectiveKeep } from "./context/scoring.js";

export interface CompactionResult {
  compacted: boolean;
  summary?: string;
}

import { COMPACTION_THRESHOLD, KEEP_RECENT_MESSAGES, SUMMARIZER_TOOL_ERROR_MAX_CHARS } from "../config/constants.js";
export { COMPACTION_THRESHOLD, KEEP_RECENT_MESSAGES };

/**
 * Fold a compacted history ([summary(user), ...recent], or with selectively
 * kept messages in front) so role alternation survives — every two adjacent
 * same-role messages are merged into one. The kept tail can start with a user
 * message, and a selectively-kept message can land beside the summary or
 * beside another kept message of its own role (the selection is by relevance,
 * not adjacency), so repairing only the first pair is not enough — several
 * providers reject any consecutive same-role pair. Merging preserves every
 * part's content; nothing is invented and nothing is dropped. Pure, and
 * returns the input array itself when it is already valid.
 */
export function mergeSummaryIntoHistory(
  compacted: ConversationMessage[]
): ConversationMessage[] {
  if (compacted.length < 2) return compacted;
  const out: ConversationMessage[] = [compacted[0]];
  let changed = false;
  for (let i = 1; i < compacted.length; i++) {
    const prev = out[out.length - 1];
    const msg = compacted[i];
    if (prev.role === msg.role) {
      out[out.length - 1] = { role: prev.role, content: mergeContent(prev.content, msg.content) };
      changed = true;
      continue;
    }
    out.push(msg);
  }
  return changed ? out : compacted;
}

/**
 * Merge two same-role messages' content. Tool results lead: providers require
 * tool_result blocks at the start of the user turn that answers them (and
 * Anthropic rejects them anywhere else in it), so merged text must not push a
 * result behind narration.
 */
function mergeContent(
  a: ConversationMessage["content"],
  b: ConversationMessage["content"]
): ConversationMessage["content"] {
  const isResult = (c: ConversationMessage["content"][number]): boolean => c.type === "tool_result";
  return [...a.filter(isResult), ...b.filter(isResult), ...a.filter((c) => !isResult(c)), ...b.filter((c) => !isResult(c))];
}

/**
 * Widen a selectively-kept index set so it never orphans a tool interaction: a
 * kept tool_call pulls in its tool_result and vice versa, as far as
 * `messages` knows them. Without this the kept prefix can hold half a pair
 * (the call summarized away, the result kept verbatim) and the history the
 * provider replays is malformed. Pairs spanning the compaction cut are the
 * cut's business, not this function's. Pure.
 */
function closeToolPairs(
  kept: readonly number[],
  messages: readonly ConversationMessage[]
): number[] {
  const set = new Set(kept);
  const callAt = new Map<string, number>();
  const resultAt = new Map<string, number>();
  for (let i = 0; i < messages.length; i++) {
    for (const c of messages[i].content) {
      if (c.type === "tool_call") callAt.set(c.call.id, i);
      else if (c.type === "tool_result") resultAt.set(c.result.toolCallId, i);
    }
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const i of [...set]) {
      for (const c of messages[i].content) {
        const partner =
          c.type === "tool_call"
            ? resultAt.get(c.call.id)
            : c.type === "tool_result"
              ? callAt.get(c.result.toolCallId)
              : undefined;
        if (partner !== undefined && !set.has(partner)) {
          set.add(partner);
          changed = true;
        }
      }
    }
  }
  return [...set].sort((x, y) => x - y);
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

export function findCleanCompactionCut(
  history: ConversationMessage[],
  targetCut: number
): number {
  if (targetCut <= 0 || targetCut >= history.length) return targetCut;

  // Precompute tool call/result intervals in O(N) to avoid O(N^2) scans
  const callIndices = new Map<string, number>();
  const intervals: Array<{ start: number; end: number }> = [];

  for (let i = 0; i < history.length; i++) {
    for (const c of history[i].content) {
      if (c.type === "tool_call") {
        callIndices.set(c.call.id, i);
      } else if (c.type === "tool_result") {
        const start = callIndices.get(c.result.toolCallId);
        if (start !== undefined) {
          intervals.push({ start, end: i });
        }
      }
    }
  }

  const splitCuts = new Set<number>();
  for (const inv of intervals) {
    for (let c = inv.start + 1; c <= inv.end; c++) {
      splitCuts.add(c);
    }
  }

  const isSplit = (cut: number): boolean => splitCuts.has(cut);

  if (!isSplit(targetCut)) return targetCut;

  // First try shifting cut backwards so the incomplete tool interaction is kept in recent
  for (let cut = targetCut - 1; cut > 0; cut--) {
    if (!isSplit(cut)) return cut;
  }

  // If shifting backwards leaves nothing to summarize, try shifting forwards
  for (let cut = targetCut + 1; cut < history.length; cut++) {
    if (!isSplit(cut)) return cut;
  }

  return targetCut;
}

export async function compactIfNeeded(
  history: ConversationMessage[],
  contextWindow: number,
  latestInputTokens: number,
  provider: ModelProvider,
  model: string,
  signal?: AbortSignal,
  options?: { summarizerModel?: string; task?: string }
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

  const targetCut = history.length - KEEP_RECENT_MESSAGES;
  const cut = findCleanCompactionCut(history, targetCut);
  if (cut <= 0 || cut >= history.length) {
    return { history, result: { compacted: false } };
  }

  const toSummarize = history.slice(0, cut);
  const recent = history.slice(cut);

  // Phase 25.5 → product: intelligent compaction. Instead of summarizing the
  // entire pre-cut history wholesale, keep high-relevance older messages
  // verbatim (keyword overlap with the task + recency + file-aware weight)
  // within the token budget and summarize only the remainder. When no task is
  // known (e.g. resumed sessions without the last prompt) the scorer falls
  // back to recency-only, so behavior degrades gracefully to pre-selective.
  let summariesToKeep: ConversationMessage[] = [];
  let summarizeThese: ConversationMessage[] = toSummarize;
  if (options?.task) {
    const keepTokens = Math.max(
      0,
      contextWindow - (latestInputTokens + KEEP_RECENT_MESSAGES * 4)
    );
    // Keep only the recent tail within the budget; everything older than the
    // oldest kept message is what the summarizer condenses.
    const keptIndices = selectiveKeep(toSummarize, options.task, keepTokens);
    // Relevance is scored per message, not per adjacency, so the selection can
    // hold half a tool interaction. Widen it to whole pairs before slicing:
    // replaying a lone call or lone result is a malformed payload.
    const closedKept = closeToolPairs(keptIndices, toSummarize);
    if (closedKept.length > 0 && closedKept.length < toSummarize.length) {
      summariesToKeep = closedKept.map((i) => toSummarize[i]);
      summarizeThese = toSummarize.filter((_, i) => !closedKept.includes(i));
    }
  }

  if (summarizeThese.length === 0) {
    return { history, result: { compacted: false } };
  }

    const modelToUse = options?.summarizerModel || model;
  const summaryText = await summarizeMessages(summarizeThese, provider, modelToUse, signal);
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

  // Kept verbatim come first (oldest kept → newest), then the summary of what
  // was older, then the live recent tail. Role alternation is repaired by
  // mergeSummaryIntoHistory on the caller side.
  return {
    history: [...summariesToKeep, summaryMessage, ...recent],
    result: { compacted: true, summary: summaryText },
  };
}

/**
 * Strip tool call/result payloads down to short text markers for the
 * summarizer call. Full outputs stay in live history; the summary input
 * keeps narration plus which tools ran and short error excerpts only.
 */
export function toSummarizerMessages(messages: ConversationMessage[]): ConversationMessage[] {
  const out: ConversationMessage[] = [];
  for (const m of messages) {
    const content: ConversationMessage["content"] = [];
    for (const c of m.content) {
      if (c.type === "text") {
        if (c.text.trim()) content.push(c);
      } else if (c.type === "tool_call") {
        content.push({ type: "text", text: `[tool call: ${c.call.name}]` });
      } else if (c.type === "tool_result") {
        if (c.result.isError) {
          content.push({ type: "text", text: `[tool error: ${c.result.content.slice(0, SUMMARIZER_TOOL_ERROR_MAX_CHARS)}]` });
        }
      } else if (c.type === "image") {
        content.push({ type: "text", text: "[image attached]" });
      }
    }
    if (content.length > 0) out.push({ role: m.role, content });
  }
  return out;
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
  // Shape the input first: tool call/result payloads (often kilobytes of JSON)
  // compete with the main turn for quota and context, so the summarizer sees
  // text plus short markers — outcomes live in the surrounding narration.
  const input = toSummarizerMessages(messages);
  if (input.length === 0) return "";
  let text = "";
  try {
    const stream = provider.streamCompletion({
      model,
      systemPrompt:
        "Summarize the following coding-session conversation concisely. Preserve: decisions " +
        "made, files created or modified and why, and any unresolved questions. Omit pleasantries " +
        "and restating tool output verbatim.",
      messages: input,
      tools: [],
      maxTokens: 1024,
      signal,
    });
    for await (const event of stream) {
      if (event.type === "text_delta") text += event.text;
      if (event.type === "error") {
        // Rate limits or provider errors during compaction summarization gracefully skip
        return "";
      }
    }
  } catch {
    // If stream initialization fails or throws, gracefully return empty string
    return "";
  }
  return text;
}
