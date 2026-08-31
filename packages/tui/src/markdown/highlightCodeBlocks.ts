import { highlight } from "cli-highlight";

const FENCE_RE = /```(\w*)\n([\s\S]*?)```/g;

/**
 * Second-pass rendering: applied ONCE when a message finishes streaming (never
 * mid-stream — partial fences aren't valid to highlight and would flicker).
 * Fenced code blocks get syntax-highlighted; everything else passes through.
 */
export function highlightCodeBlocks(text: string): string {
  return text.replace(FENCE_RE, (_match, lang: string, code: string) => {
    try {
      return highlight(code, { language: lang || undefined, ignoreIllegals: true });
    } catch {
      return code; // unknown language or highlight failure — fall back to plain text
    }
  });
}
