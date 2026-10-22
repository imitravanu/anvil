import { useMemo, useState } from "react";
import { Box, Text, useStdout } from "ink";
import { useInput } from "../hooks/useUIInput.js";
import { HELP_VISIBLE_ROWS, HELP_FILTER_MAX } from "../util/displayLimits.js";
import { sectionRule } from "../util/chrome.js";
import { curtail } from "../util/format.js";
import { wrapSpans } from "../util/wrapSpans.js";
import { sanitizeTerminalText } from "../util/sanitize.js";
import { HELP_KEYS, filterHelpSections, helpSections, type HelpRow } from "../commands/help.js";
import { useTheme } from "../theme/theme.js";
import { OverlayFrame } from "./OverlayFrame.js";

/** Left-column width for the key/command table (chords are ASCII). */
const PRIMARY_COL = 18;

type HelpLine = { kind: "section"; title: string } | { kind: "row"; row: HelpRow } | { kind: "wrapped"; text: string };

/**
 * Phase 41 — the help surface. Replaces the transcript prose dump: every
 * command in the registry plus the real keybindings, filterable by typing and
 * scrollable with ↑/↓ (the content is taller than any terminal).
 */
export function HelpOverlay({ onClose, minimal = false }: { onClose: () => void; minimal?: boolean }) {
  const theme = useTheme();
  const { stdout } = useStdout();
  const [filter, setFilter] = useState("");
  const [offset, setOffset] = useState(0);

  const sections = useMemo(() => filterHelpSections(helpSections(), filter), [filter]);
  const lines: HelpLine[] = useMemo(() => {
    const out: HelpLine[] = [];
    for (const section of sections) {
      out.push({ kind: "section", title: section.title });
      for (const row of section.rows) {
        if (minimal) out.push(...wrapSpans([{ text: `${row.primary}  ${row.secondary}` }], Math.max(1, (stdout?.columns ?? 80) - 4)).map(line => ({ kind: "wrapped" as const, text: line.spans.map(span => span.text).join("") })));
        else out.push({ kind: "row", row });
      }
    }
    return out;
  }, [sections, minimal, stdout?.columns]);

  // The frame owns the terminal, so the content budget follows the live rows
  // (a short terminal still shows a usable window instead of a clipped one).
  const budget = minimal ? Math.max(1, Math.min(HELP_VISIBLE_ROWS, (stdout?.rows ?? 24) - 10)) : Math.max(6, Math.min(HELP_VISIBLE_ROWS, (stdout?.rows ?? 24) - 12));
  const maxOffset = Math.max(0, lines.length - budget);
  const clamped = Math.min(offset, maxOffset);
  const visible = lines.slice(clamped, clamped + budget);

  useInput((input, key) => {
    if (key.escape || input === "?") {
      onClose();
      return;
    }
    if (key.upArrow) {
      setOffset((o) => Math.max(0, Math.min(o, maxOffset) - 1));
      return;
    }
    if (key.downArrow) {
      setOffset((o) => Math.min(maxOffset, o + 1));
      return;
    }
    if (key.backspace) {
      setFilter((f) => f.slice(0, -1));
      setOffset(0);
      return;
    }
    if (!key.ctrl && !key.meta) {
      // Ink hands a pasted chunk as ONE multi-character `input`, so a
      // length===1 guard (the pickers' old rule) silently dropped every
      // paste into the filter. Sanitize then append, exactly like InputBar:
      // raw control bytes in the buffer would render as frame garbage.
      const printable = sanitizeTerminalText(input);
      if (printable) {
        setFilter((f) => f + printable);
        setOffset(0);
      }
    }
  });

  return (
    <OverlayFrame
      minimal={minimal}
      title="Help"
      meta={`(${HELP_KEYS.length} keys · ${sections.find((s) => s.id === "commands")?.rows.length ?? 0} commands)`}
      hints="type to filter · ↑/↓ scroll · Esc close"
    >
      {filter && (
        <Text color={theme.colors.textSecondary} wrap="truncate-end">
          filter: <Text color={theme.colors.toolName}>{curtail(filter, HELP_FILTER_MAX)}</Text> — Backspace to erase
        </Text>
      )}
      {lines.length === 0 ? (
        <Text color={theme.colors.textSecondary}>
          No matching help rows — Backspace to erase, Esc to close.
        </Text>
      ) : (
        <Box flexDirection="column">
          {clamped > 0 && (
            <Text color={theme.colors.textSecondary}>  ▲ {clamped} more above…</Text>
          )}
          {visible.map((line, i) =>
            line.kind === "section" ? (
              <Text key={`s-${line.title}-${i}`} color={theme.colors.textSecondary}>
                <Text color={theme.colors.separator}>
                  {sectionRule(theme.typography.sectionDivider, 2)}{" "}
                </Text>
                <Text bold>{line.title}</Text>
              </Text>
            ) : line.kind === "wrapped" ? <Text key={`w-${i}`} color={theme.colors.textSecondary}>{line.text}</Text> : (
              <Text key={`r-${line.row.primary}-${i}`}>
                <Text color={theme.colors.accent}>
                  {curtail(line.row.primary, PRIMARY_COL).padEnd(PRIMARY_COL)}
                </Text>
                <Text color={theme.colors.textSecondary}>{line.row.secondary}</Text>
              </Text>
            )
          )}
          {clamped + budget < lines.length && (
            <Text color={theme.colors.textSecondary}>
              {"  ▼ "}
              {lines.length - clamped - budget} more below — ↓ to scroll
            </Text>
          )}
        </Box>
      )}
    </OverlayFrame>
  );
}
