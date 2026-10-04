/**
 * Code-point-aware string caps — a leaf module (no internal imports) so every
 * core caller shares one implementation instead of re-deriving the same
 * near-miss.
 *
 * `String#slice` counts UTF-16 units, so a cap landing between a surrogate pair
 * keeps half a code point: the retained text is invalid UTF-16, JSON.stringify
 * escapes the lone half (`\ud83d`), and the provider or renderer shows a
 * replacement glyph where a whole emoji was. The TUI's `headChars`/`tailChars`
 * (`packages/tui/src/util/format.ts`) own the display side of this rule; core
 * cannot import them — the dependency runs TUI → core — so the two model-facing
 * report caps (sub-agent report, team report) share this instead.
 */

/** The first `max` code points of `text`, or `text` when it already fits. */
export function headChars(text: string, max: number): string {
  if (max <= 0) return "";
  // Unit count is an upper bound on code-point count: this fast path can only
  // under-truncate, never split, so no Array.from allocation on the common path.
  if (text.length <= max) return text;
  const chars = Array.from(text);
  return chars.length <= max ? text : chars.slice(0, max).join("");
}
