import type { ConversationMessage } from "../../providers/types.js";

/**
 * Phase 25.5 — Intelligent Context Management.
 * Relevance scoring: keyword overlap with the current task + recency +
 * file-aware weighting (recently edited files score higher).
 */

export interface ScoredMessage {
  index: number;
  score: number;
  tokens: number;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((w) => w.length >= 3);
}

function messageText(message: ConversationMessage): string {
  const parts: string[] = [];
  for (const c of message.content) {
    if (c.type === "text") parts.push(c.text);
    else if (c.type === "tool_call") parts.push(`${c.call.name} ${JSON.stringify(c.call.input ?? {})}`);
    else if (c.type === "tool_result") parts.push(c.result.content);
  }
  return parts.join("\n");
}

function estimateMessageTokens(message: ConversationMessage): number {
  return Math.ceil(messageText(message).length / 4);
}

/**
 * Score every message 0..1. Recent messages and messages sharing
 * vocabulary with the task or touching recent files rank highest.
 */
export function scoreMessages(
  messages: readonly ConversationMessage[],
  task: string,
  recentFiles: string[] = []
): ScoredMessage[] {
  const taskTerms = new Set(tokenize(task));
  const recentLower = recentFiles.map((f) => f.toLowerCase());
  const total = messages.length;
  return messages.map((message, index) => {
    const text = messageText(message);
    const terms = tokenize(text);
    let overlap = 0;
    for (const term of terms) {
      if (taskTerms.has(term)) overlap += 1;
    }
    const keywordScore = taskTerms.size === 0 ? 0 : Math.min(1, overlap / Math.max(4, taskTerms.size));
    const recencyScore = total <= 1 ? 1 : index / (total - 1);
    const lower = text.toLowerCase();
    const fileScore = recentLower.length === 0 ? 0 : recentLower.some((f) => lower.includes(f)) ? 1 : 0;
    const score = 0.5 * keywordScore + 0.3 * recencyScore + 0.2 * fileScore;
    return { index, score, tokens: estimateMessageTokens(message) };
  });
}

export interface ContextBreakdown {
  totalTokens: number;
  byRole: { user: number; assistant: number };
  toolTokens: number;
  textTokens: number;
  messageCount: number;
  /** Fraction of the window used (0..1+, may exceed 1). */
  utilization: number;
  shouldWarn: boolean;
}

/** Token budget breakdown for /context display and predictive warnings. */
export function contextBreakdown(
  messages: readonly ConversationMessage[],
  contextWindow: number,
  warnThreshold: number
): ContextBreakdown {
  let user = 0;
  let assistant = 0;
  let toolTokens = 0;
  let textTokens = 0;
  for (const message of messages) {
    let messageTokens = 0;
    for (const c of message.content) {
      if (c.type === "text") {
        const tokens = Math.ceil(c.text.length / 4);
        textTokens += tokens;
        messageTokens += tokens;
      } else if (c.type === "tool_call") {
        const tokens = Math.ceil(JSON.stringify(c.call.input ?? {}).length / 4);
        toolTokens += tokens;
        messageTokens += tokens;
      } else if (c.type === "tool_result") {
        const tokens = Math.ceil(c.result.content.length / 4);
        toolTokens += tokens;
        messageTokens += tokens;
      } else if (c.type === "image") {
        messageTokens += 2000;
      }
    }
    if (message.role === "user") user += messageTokens;
    else assistant += messageTokens;
  }
  const totalTokens = user + assistant;
  const utilization = contextWindow > 0 ? totalTokens / contextWindow : 0;
  return {
    totalTokens,
    byRole: { user, assistant },
    toolTokens,
    textTokens,
    messageCount: messages.length,
    utilization,
    shouldWarn: utilization >= warnThreshold,
  };
}

/**
 * Selective compaction: keep high-relevance messages verbatim, summarize
 * the rest. Returns kept indices (sorted) so callers can slice history.
 */
export function selectiveKeep(
  messages: readonly ConversationMessage[],
  task: string,
  keepTokens: number,
  recentFiles: string[] = []
): number[] {
  const scored = scoreMessages(messages, task, recentFiles);
  const ranked = [...scored].sort((a, b) => b.score - a.score);
  const kept = new Set<number>();
  let used = 0;
  for (const entry of ranked) {
    if (used + entry.tokens > keepTokens) continue;
    kept.add(entry.index);
    used += entry.tokens;
  }
  // Always keep the latest message so the turn has its immediate context.
  if (messages.length > 0) kept.add(messages.length - 1);
  return [...kept].sort((a, b) => a - b);
}
