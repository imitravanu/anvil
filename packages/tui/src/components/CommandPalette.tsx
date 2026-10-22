import { Text, useStdout } from "ink";
import { windowOffset } from "../hooks/useWindowedList.js";
import { MAX_VISIBLE_ROWS } from "../util/displayLimits.js";
import { COMMANDS } from "../commands/registry.js";
import { commandIcon, filterCommands } from "../commands/palette.js";
import { useTheme } from "../theme/theme.js";
import { OverlayFrame } from "./OverlayFrame.js";

/**
 * DW-3.2 — command palette menu. Presentational: InputBar owns the query,
 * highlight index, and keys; this renders the framed overlay with icons,
 * fuzzy matches, and the keyboard contract. Rendered in place above the
 * input (Ink absolute overlays tear on scrollback) while it owns typing.
 */
export function CommandPalette({
  query,
  highlight,
  mru,
  compact = false,
}: {
  compact?: boolean;
  query: string;
  highlight: number;
  mru?: readonly string[];
}) {
  const theme = useTheme();
  // DW-3.3 focus signal: the palette owns keystrokes while mounted, so it
  // carries the bright focus border.
  const matches = filterCommands(COMMANDS, query, mru ?? []);
  const { stdout } = useStdout();
  const budget = Math.max(1, Math.min(MAX_VISIBLE_ROWS, Math.floor(((stdout?.rows ?? 24) - 12) / 2)));
  const { offset, hasAbove, hasBelow } = windowOffset(matches.length, highlight, budget);
  return (
    <OverlayFrame
      minimal={compact}
      title="Commands"
      meta={query.trim() ? `“${query.trim()}”` : `(${matches.length})`}
      hints="↑/↓ navigate · Enter run · Esc close · Tab fill"
    >
      {matches.length === 0 ? (
        <Text color={theme.colors.textSecondary}>No matching commands.</Text>
      ) : (
        matches.slice(offset, offset + budget).map((command, local) => {
          const i = local + offset;
          return (
          <Text key={command.name} wrap={compact ? "truncate-end" : "wrap"}>
            <Text color={i === highlight ? theme.colors.brand : theme.colors.textSecondary}>
              {i === highlight ? "❯ " : "  "}
            </Text>
            {!compact && <Text color={theme.colors.accent}>{commandIcon(command.name)} </Text>}
            <Text color={theme.colors.toolName}>/{command.name}</Text>
            <Text color={i === highlight ? theme.colors.userText : theme.colors.textSecondary}>
              {" — "}
              {command.description}
            </Text>
          </Text>
        ); })
      )}
      {(hasAbove || hasBelow) && <Text color={theme.colors.textSecondary}>↑/↓ more · {highlight + 1}/{matches.length}</Text>}
    </OverlayFrame>
  );
}
