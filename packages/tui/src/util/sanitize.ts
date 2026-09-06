/**
 * Terminal-safe text for Ink frames. Assistant text, tool summaries, and
 * verification output all originate outside the app and can carry raw control
 * characters — a lone \r (npm/pip progress lines), ANSI color codes, tab
 * stops. Ink counts rendered rows from the string alone, so any of those
 * desyncs the terminal's real cursor and every later redraw lands on the
 * wrong rows: borders break and lines overwrite each other. The keyboard path
 * is sanitized at the InputBar; this guards every display sink.
 */

// CSI (ESC [ params final), OSC (ESC ] ... BEL/ST), and any other ESC sequence.
const ANSI_RE =
  /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b./g;

// C0 controls that have no business in a frame line (\n handled by split,
// \r handled by segment rules, \t expanded before this runs).
const STRIP_C0_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

export function sanitizeTerminalText(text: string): string {
  return text
    .replace(ANSI_RE, "")
    // CRLF is a plain newline; a bare \r is an overwrite. Normalize first so
    // CRLF lines keep their content through the last-segment rule below.
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => {
      // Terminal overwrite semantics: segments after \r replaced earlier ones,
      // so only the last segment was ever visible.
      const last = line.split("\r").pop() ?? "";
      // Tabs jump to tab stops Ink never accounts for — expand to spaces.
      return last.replace(/\t/g, "  ").replace(STRIP_C0_RE, "");
    })
    .join("\n");
}
