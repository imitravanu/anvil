import { highlight } from "cli-highlight";
import { detectColorSupport } from "../theme/colorSupport.js";

const FENCE_RE = /```([^\s`]*)\n([\s\S]*?)```/g;

/**
 * Second-pass rendering: applied ONCE when a message finishes streaming (never
 * mid-stream — partial fences aren't valid to highlight and would flicker).
 * Fenced code blocks get syntax-highlighted; everything else passes through.
 */
export function highlightCodeBlocks(text: string): string {
  // NO_COLOR (presence, any value) and dumb terminals win everywhere.
  // Ink/chalk already honors them for <Text> colors, but cli-highlight emits
  // RAW ANSI and needs this guard. Fences are still stripped (plain code) so
  // rendering stays consistent.
  if (detectColorSupport() === "none") {
    return text.replace(FENCE_RE, (_match, _lang: string, code: string) => code);
  }
  return text.replace(FENCE_RE, (_match, lang: string, code: string) => {
    try {
      return highlight(code, { language: lang || undefined, ignoreIllegals: true });
    } catch {
      // intentional: unknown language or highlight failure falls back to plain text.
      return code;
    }
  });
}
