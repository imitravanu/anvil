import { highlight } from "cli-highlight";

const FENCE_RE = /```([^\s`]*)\n([\s\S]*?)```/g;

/**
 * Second-pass rendering: applied ONCE when a message finishes streaming (never
 * mid-stream — partial fences aren't valid to highlight and would flicker).
 * Fenced code blocks get syntax-highlighted; everything else passes through.
 */
export function highlightCodeBlocks(text: string): string {
  // NO_COLOR must win everywhere. Ink/chalk already honors it
  // for <Text> colors, but cli-highlight emits RAW ANSI and needs this guard.
  // Fences are still stripped (plain code) so rendering stays consistent.
  if (process.env.NO_COLOR) {
    return text.replace(FENCE_RE, (_match, _lang: string, code: string) => code);
  }
  return text.replace(FENCE_RE, (_match, lang: string, code: string) => {
    try {
      return highlight(code, { language: lang || undefined, ignoreIllegals: true });
    } catch {
      return code; // unknown language or highlight failure — fall back to plain text
    }
  });
}
