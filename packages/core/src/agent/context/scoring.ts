import type { ConversationMessage } from "../../providers/types.js";
import {
  ASCII_CHARS_PER_TOKEN,
  CJK_TOKENS_PER_CHAR,
  IMAGE_TOKEN_ESTIMATE,
  SCORE_WEIGHT_FILE,
  SCORE_WEIGHT_KEYWORD,
  SCORE_WEIGHT_RECENCY,
  TOKEN_CALIBRATION_MAX,
  TOKEN_CALIBRATION_MIN,
  TOKEN_CALIBRATION_SMOOTHING,
} from "../../config/constants.js";

/**
 * Wide-script ranges that cost ~1 token per character. ASCII on purpose: a
 * literal-character class in source is an encoding hazard (an editor or a
 * mojibake re-encode silently changes which code points match).
 */
function isWideCodePoint(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x11ff) || // Hangul Jamo
    (cp >= 0x2e80 && cp <= 0x303e) || // CJK radicals + punctuation
    (cp >= 0x3041 && cp <= 0x33ff) || // Kana + CJK compatibility
    (cp >= 0x3400 && cp <= 0x4dbf) || // CJK Unified Ext A
    (cp >= 0x4e00 && cp <= 0x9fff) || // CJK Unified Ideographs
    (cp >= 0xa000 && cp <= 0xa4cf) || // Yi
    (cp >= 0xac00 && cp <= 0xd7a3) || // Hangul syllables
    (cp >= 0xf900 && cp <= 0xfaff) || // CJK compatibility ideographs
    (cp >= 0xff00 && cp <= 0xff60) // Fullwidth forms
  );
}

/**
 * Estimate tokens for a text payload, counting wide-script characters at their
 * real cost instead of a flat chars/4. Pure and unit-tested without a provider.
 */
export function estimateTextTokens(text: string): number {
  if (!text) return 0;
  let wide = 0;
  for (const ch of text) {
    if (isWideCodePoint(ch.codePointAt(0) ?? 0)) wide += 1;
  }
  const narrow = text.length - wide;
  return Math.ceil(narrow / ASCII_CHARS_PER_TOKEN + wide * CJK_TOKENS_PER_CHAR);
}

/**
 * Fold one measured-vs-estimated observation into a session's calibration
 * factor. Smoothed so a single odd usage report cannot swing it, and clamped so
 * the factor stays a correction rather than a runaway multiplier. A degenerate
 * measurement (no usage reported, or an empty history) leaves it unchanged.
 */
export function nextCalibration(previous: number, measured: number, estimated: number): number {
  if (!(measured > 0) || !(estimated > 0)) return previous;
  const ratio = measured / estimated;
  const smoothed =
    TOKEN_CALIBRATION_SMOOTHING * previous + (1 - TOKEN_CALIBRATION_SMOOTHING) * ratio;
  return Math.min(TOKEN_CALIBRATION_MAX, Math.max(TOKEN_CALIBRATION_MIN, smoothed));
}

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
  return estimateTextTokens(messageText(message));
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
    const score =
      SCORE_WEIGHT_KEYWORD * keywordScore +
      SCORE_WEIGHT_RECENCY * recencyScore +
      SCORE_WEIGHT_FILE * fileScore;
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
  warnThreshold: number,
  /** The session's learned calibration factor; applied to every bucket. */
  scale = 1
): ContextBreakdown {
  let user = 0;
  let assistant = 0;
  let toolTokens = 0;
  let textTokens = 0;
  for (const message of messages) {
    let messageTokens = 0;
    for (const c of message.content) {
      if (c.type === "text") {
        const tokens = estimateTextTokens(c.text);
        textTokens += tokens;
        messageTokens += tokens;
      } else if (c.type === "tool_call") {
        const tokens = estimateTextTokens(JSON.stringify(c.call.input ?? {}));
        toolTokens += tokens;
        messageTokens += tokens;
      } else if (c.type === "tool_result") {
        const tokens = estimateTextTokens(c.result.content);
        toolTokens += tokens;
        messageTokens += tokens;
      } else if (c.type === "image") {
        messageTokens += IMAGE_TOKEN_ESTIMATE;
      }
    }
    if (message.role === "user") user += messageTokens;
    else assistant += messageTokens;
  }
  // Scale every bucket by the same factor so the byRole line still sums to the
  // total the user is shown.
  const factor = scale > 0 ? scale : 1;
  const scaledUser = Math.round(user * factor);
  const scaledAssistant = Math.round(assistant * factor);
  const totalTokens = scaledUser + scaledAssistant;
  const utilization = contextWindow > 0 ? totalTokens / contextWindow : 0;
  return {
    totalTokens,
    byRole: { user: scaledUser, assistant: scaledAssistant },
    toolTokens: Math.round(toolTokens * factor),
    textTokens: Math.round(textTokens * factor),
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
