import { Box, Text } from "ink";
import { COMMANDS } from "../commands/registry.js";
import { commandIcon, filterCommands } from "../commands/palette.js";
import { useTheme } from "../theme/theme.js";

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
}: {
  query: string;
  highlight: number;
  mru?: readonly string[];
}) {
  const theme = useTheme();
  // DW-3.3 focus signal: the palette owns keystrokes while mounted, so it
  // carries the bright focus border.
  const matches = filterCommands(COMMANDS, query, mru ?? []);
  return (
    <Box
      flexDirection="column"
      flexShrink={0}
      borderStyle={theme.borders.panel}
      borderColor={theme.colors.borderFocus}
      paddingX={1}
    >
      {matches.length === 0 ? (
        <Text color={theme.colors.dim}>No matching commands.</Text>
      ) : (
        matches.map((command, i) => (
          <Text key={command.name}>
            <Text color={i === highlight ? theme.colors.brand : theme.colors.dim}>
              {i === highlight ? "❯ " : "  "}
            </Text>
            <Text color={theme.colors.accent}>{commandIcon(command.name)} </Text>
            <Text color={theme.colors.toolName}>/{command.name}</Text>
            <Text color={i === highlight ? theme.colors.userText : theme.colors.dim}>
              {" — "}
              {command.description}
            </Text>
            {i === highlight ? (
              <Text color={theme.colors.accent}> (Tab fill · Enter run)</Text>
            ) : null}
          </Text>
        ))
      )}
      <Text dimColor> ↑/↓ navigate · Enter run · Esc close · Tab fill</Text>
    </Box>
  );
}
